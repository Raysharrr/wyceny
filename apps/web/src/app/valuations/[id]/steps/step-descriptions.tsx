"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FileEdit, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { confirmProse } from "@/app/actions/confirm-prose";
import { proposeProse, type ProposeProseResult } from "@/app/actions/propose-prose";
import { FootNav } from "@/components/wizard/foot-nav";
import { SectionCard } from "@/components/wizard/section-card";
import {
  PROSE_SECTIONS,
  PROSE_SECTION_LABEL,
  mergeProseProposal,
  type ProseSection,
  type ProseSnapshot,
} from "@/domain/prose-snapshot";
import type { Provenance } from "@wyceny/shared";

/**
 * What a section would need before the automat is allowed to attempt it.
 * Mirrors `selectProseSections` (`domain/prose.ts`) — a section missing from
 * `generatableSections` was skipped on purpose, and the appraiser is owed the
 * reason rather than an empty box.
 */
const MISSING_DATA_HINT: Record<ProseSection, string> = {
  // Missing dates or areas no longer withhold this section: the aggregate is
  // simply absent and the model drops that thread. What withholds it now is
  // having no usable sample at all (writing the help page caught the drift).
  analiza_rynku: "Brak użytecznej próby porównawczej — napisz tę sekcję ręcznie.",
  opis_lokalu: "Brak notatki z oględzin — napisz opis ręcznie.",
  otoczenie: "Brak notatki z oględzin — napisz opis ręcznie.",
  zagospodarowanie: "Brak notatki z oględzin i danych ewidencyjnych — napisz opis ręcznie.",
  standard: "Brak notatki z oględzin i ocen cech — napisz opis ręcznie.",
  uzasadnienie: "Brak próby albo cech z niezerową wagą — napisz uzasadnienie ręcznie.",
};

const DISCLAIMER =
  "Propozycja wygenerowana automatycznie — za treść operatu odpowiada rzeczoznawca.";

type ProseTexts = Record<ProseSection, string>;

function textsOf(snapshot: ProseSnapshot | null): ProseTexts {
  return Object.fromEntries(
    PROSE_SECTIONS.map((section) => [section, snapshot?.sections[section]?.value ?? ""]),
  ) as ProseTexts;
}

/** A section still open to the automat: absent, or still carrying `ai` text. */
function isStillTheAutomats(snapshot: ProseSnapshot | null, section: ProseSection): boolean {
  const entry = snapshot?.sections[section];
  return !entry || entry.provenance.source === "ai";
}

/**
 * Generations in flight, keyed by valuation — MODULE scope on purpose.
 *
 * The mount guard is a `useRef`, so it dies with the component: stepping 6 → 5
 * → 6 during the ~10 s call remounts the step, finds nothing persisted yet, and
 * starts a SECOND paid generation. This map outlives the mount (client-side
 * navigation keeps the module alive), so the returning mount JOINS the running
 * call instead of buying another one — it still shows the loading state and
 * still receives the result.
 */
const inFlight = new Map<string, Promise<ProposeProseResult>>();

function generateOnce(valuationId: string): Promise<ProposeProseResult> {
  const running = inFlight.get(valuationId);
  if (running) return running;
  const started = proposeProse(valuationId).finally(() => inFlight.delete(valuationId));
  inFlight.set(valuationId, started);
  return started;
}

/**
 * The badge states the F-4 gate's own two questions: whose text is this, and
 * has it been accepted. Both matter — a new version inherits the appraiser's
 * own text with its confirmation reset (`newVersionOf`, T7), and a badge
 * reading "potwierdzone" there would contradict the blocker on step 7.
 */
function ProseProvenanceBadge({ provenance }: { provenance: Provenance | undefined }) {
  if (!provenance) return null;
  const who = provenance.source === "ai" ? "AI" : "Rzeczoznawca";
  if (provenance.status !== "confirmed") {
    return (
      <Badge variant="outline" className="border-amber-500 text-amber-600 dark:text-amber-500">
        {who} — do weryfikacji
      </Badge>
    );
  }
  return <Badge variant="secondary">{who} — potwierdzone</Badge>;
}

export type StepDescriptionsProps = {
  valuationId: string;
  /** Proposals persisted on the draft, or null when none were ever generated. */
  prose: ProseSnapshot | null;
  /** Whether `prose.factsHash` still matches the draft's current facts. */
  upToDate: boolean;
  /** Sections today's facts can back — computed server-side by `selectProseSections`. */
  generatableSections: ProseSection[];
};

/**
 * Step 6 ("Sekcje opisowe") — FR-6 / ADR-014.
 *
 * `NEXT_PUBLIC_PROSE=off` falls back to the pre-FR-6 placeholder: no editors,
 * no auto-generation, no network. The CI smoke runs with the flag off and
 * walks past this step by clicking the link labelled "Dalej", so that branch
 * must stay exactly as it was. The env read is deliberately inline (Next
 * inlines `NEXT_PUBLIC_*` textually at build time) and this component holds no
 * hooks, so the early return cannot reorder any.
 */
export function StepDescriptions(props: StepDescriptionsProps) {
  if (process.env.NEXT_PUBLIC_PROSE === "off") {
    return <ProsePlaceholder valuationId={props.valuationId} />;
  }
  return <ProseEditors {...props} />;
}

function ProsePlaceholder({ valuationId }: { valuationId: string }) {
  return (
    <>
      <SectionCard icon={FileEdit} title="Opisy">
        <p className="text-sm text-muted-foreground">
          Generator prozy sekcji opisowych (FR-6) — w przygotowaniu. Opisy operatu powstają na razie
          deterministycznie z szablonu przy zatwierdzeniu.
        </p>
      </SectionCard>
      <FootNav
        back={{ href: `/valuations/${valuationId}?step=5` }}
        mid="Opisy z szablonu przy zatwierdzeniu"
      >
        <Link
          href={`/valuations/${valuationId}?step=7`}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-[14.5px] font-medium text-primary-foreground shadow-sm hover:bg-[var(--accent-700)]"
        >
          Dalej
        </Link>
      </FootNav>
    </>
  );
}

function ProseEditors({
  valuationId,
  prose,
  upToDate,
  generatableSections,
}: StepDescriptionsProps) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<ProseSnapshot | null>(prose);
  const [texts, setTexts] = useState<ProseTexts>(() => textsOf(prose));
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Read path for the async callbacks — a dependency-free mirror of the state
  // above, so the mount effect below never has to re-run to see a fresh value.
  const snapshotRef = useRef<ProseSnapshot | null>(prose);
  // "I already started one." Survives StrictMode's double-invoked mount effect
  // and any re-render — a second generation is a second bill.
  const autoStarted = useRef(false);
  const mounted = useRef(true);

  const generate = async () => {
    setError(null);
    setGenerating(true);
    let result: ProposeProseResult;
    try {
      result = await generateOnce(valuationId);
    } catch (error) {
      // The action itself failed to reach the server (offline, dropped
      // connection). Without this the loading state would hang forever on an
      // unhandled rejection, and the step offers no way out of it.
      console.error("proposeProse call failed", error);
      if (mounted.current) {
        setGenerating(false);
        setError("Nie udało się połączyć z serwerem — sprawdź połączenie i spróbuj ponownie.");
      }
      return;
    }
    // The appraiser may have left the step during the ~10 s call; writing into
    // an unmounted tree (or over a newer state) helps nobody.
    if (!mounted.current) return;
    setGenerating(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    // The repo persisted the MERGE, not the raw proposal (confirmed sections
    // survive a regeneration) — the screen must show the same thing, so the
    // same domain rule is applied here rather than re-derived.
    const merged = mergeProseProposal(snapshotRef.current, result.prose);
    snapshotRef.current = merged;
    setSnapshot(merged);
    setTexts(textsOf(merged));
    router.refresh();
  };

  useEffect(() => {
    mounted.current = true;
    // Entering the step generates when there is nothing yet, or when the draft
    // moved on since the proposals were written — but never when every section
    // the facts can back already belongs to the appraiser: the merge would
    // discard all of it and the tokens would be spent for nothing.
    const openToTheAutomat = generatableSections.some((s) => isStillTheAutomats(prose, s));
    if (!autoStarted.current && openToTheAutomat && (!prose || !upToDate)) {
      autoStarted.current = true;
      void generate();
    }
    return () => {
      mounted.current = false;
    };
    // Mount only: this is a paid side effect, not a subscription. The guard
    // above — not the dependency list — is what keeps it to one call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    const result = await confirmProse(valuationId, texts);
    if (!mounted.current) return;
    setSaving(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    router.push(`/valuations/${valuationId}?step=7`);
  };

  const filled = PROSE_SECTIONS.filter((s) => texts[s].trim().length > 0).length;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <SectionCard
        icon={FileEdit}
        title="Sekcje opisowe"
        sub="propozycje do przeczytania, poprawienia i zatwierdzenia"
      >
        <div className="flex flex-col gap-4">
          <p data-testid="prose-disclaimer" className="text-sm text-muted-foreground">
            {DISCLAIMER}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={generating || saving}
              onClick={() => void generate()}
            >
              <Sparkles className="size-4" />
              Wygeneruj ponownie
            </Button>
            <p data-testid="prose-regenerate-note" className="text-[12.5px] text-muted-foreground">
              Ponowna generacja nadpisze niezapisane teksty; zatwierdzone teksty nie zostaną
              nadpisane.
            </p>
          </div>

          {generating ? (
            <p data-testid="prose-generating" className="text-sm text-muted-foreground">
              ⏳ Generuję opisy — to potrwa kilkanaście sekund…
            </p>
          ) : null}

          {PROSE_SECTIONS.map((section) => {
            const entry = snapshot?.sections[section];
            const rejected = snapshot?.rejected[section];
            // Hints explain an EMPTY box; a section with persisted text needs
            // no excuse. Order matters: a concrete rejection outranks the
            // generic "we never asked for this one", which in turn outranks the
            // catch-all. There is no fourth state — an empty box with no
            // explanation is exactly what honest silence forbids, so a section
            // that was asked for and came back with neither text nor a reason
            // still says so. Only a draft where nothing has been attempted yet
            // (no snapshot at all) stays quiet.
            const hint = entry
              ? null
              : rejected && rejected.length > 0
                ? `Automat użył liczb spoza danych wyceny (${rejected.join("; ")}) — napisz tę sekcję ręcznie.`
                : rejected
                  ? "Nie udało się wygenerować tej sekcji — spróbuj ponownie albo napisz ją ręcznie."
                  : !generatableSections.includes(section)
                    ? MISSING_DATA_HINT[section]
                    : snapshot
                      ? "Nie udało się wygenerować tej sekcji — spróbuj ponownie albo napisz ją ręcznie."
                      : null;

            return (
              <div key={section} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor={`prose-${section}`} className="text-sm font-medium">
                    {PROSE_SECTION_LABEL[section]}
                  </label>
                  <span data-testid={`prose-badge-${section}`}>
                    <ProseProvenanceBadge provenance={entry?.provenance} />
                  </span>
                </div>
                <textarea
                  id={`prose-${section}`}
                  // `field-sizing-content`: the box grows to its text. QA showed the
                  // market analysis — the longest section, ~180 words, and the one the
                  // appraiser most needs to READ before confirming — showing three
                  // lines with the rest behind an inner scrollbar. Native CSS, no JS.
                  className="min-h-32 field-sizing-content w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base md:text-sm"
                  value={texts[section]}
                  disabled={generating}
                  onChange={(e) => setTexts((prev) => ({ ...prev, [section]: e.target.value }))}
                />
                {hint ? (
                  <p
                    data-testid={`prose-hint-${section}`}
                    className="text-[12.5px] text-amber-600 dark:text-amber-500"
                  >
                    {hint}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </SectionCard>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <FootNav
        back={{ href: `/valuations/${valuationId}?step=5` }}
        mid={
          <span data-testid="footnav-prose-mid">
            Wypełnione sekcje:{" "}
            <b className="num">
              {filled}/{PROSE_SECTIONS.length}
            </b>
          </span>
        }
      >
        <Button type="submit" disabled={generating || saving} className="w-fit">
          Zatwierdź opisy i dalej
        </Button>
      </FootNav>
    </form>
  );
}
