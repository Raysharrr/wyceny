import {
  isBlocking,
  sourced,
  type Provenance,
  type ProvenanceStatus,
  type Sourced,
} from "@wyceny/shared";
import type { InspectionSnapshot } from "./inspection";
import { isRegistrySourced, REGISTRY_LABEL, type ComparableSource } from "./kcs";
import { encumbranceDecisionNeeded, kwRequirements } from "./kw-requirements";
import {
  kwProvenanceSource,
  type EncumbranceTreatment,
  type KwDzialSnapshot,
  type KwGruntSnapshot,
  type KwSource,
} from "./kw-snapshot";
import type { PropertyRight } from "./property-right";
import { PROSE_SECTION_LABEL, PROSE_SECTIONS, type ProseSection } from "./prose-snapshot";
import { isPrzeznaczenieComplete } from "./przeznaczenie";
import type { SubjectSnapshot } from "./subject-snapshot";
import type { AppraiserProfile } from "../ports/profile";

/**
 * F-4 approval gate — the aggregate invariant from ADR-010/ADR-012.
 * Default-deny: a value with missing provenance counts as `none` and blocks.
 * Pure, zero I/O (F-10). Blocker labels are Polish UI copy.
 */
export const REQUIRED_SAMPLE_SIZE = 12;

export type InputsProvenance = {
  address: Provenance;
  area: Provenance;
  weights: Provenance;
  ratings: Provenance;
  /**
   * Present on every Slice-7+ snapshot (assignProvenance always sets it);
   * absent on legacy snapshots — the gate skips it then (no retro-blockers
   * on old prod drafts).
   */
  featureDefs?: Provenance;
  /**
   * The address's resolved point. Present once something has geocoded the
   * draft — the step-1 EGiB/MPZP fetch or the step-3 RCN fetch — and stamped
   * by step 1, which owns the address (T7).
   */
  geocode?: Provenance;
  /** Present only when a subject snapshot (EGiB/MPZP) was attached to the draft. */
  ewidencja?: Provenance;
  mpzp?: Provenance;
  /** Present only when a KW extract (deed/excerpt upload) was attached. */
  kw?: Provenance;
};

/**
 * `code` is the catalogue id of a paczka-1 blocker (B-01…B-16, spec §4) that
 * tests and E2E assert on. Additive: blockers from before the catalogue leave
 * it unset.
 */
export type Blocker = { path: string; label: string; code?: string };

export type GateResult = { ok: true } | { ok: false; blockers: Blocker[] };

/** Structurally compatible with KcsInput — callers pass the snapshot directly. */
export type GateInput = {
  comparables: Array<{ source?: ComparableSource; status?: ProvenanceStatus }>;
  sampleMeta?: unknown | null;
  // Typed since M-10: B-02 reads the designation fields off it.
  subject?: SubjectSnapshot | null;
  // Typed since M-1: B-01 reads the building photos off it, and the first of
  // them is the operat's cover.
  inspection?: InspectionSnapshot | null;
  kw?: {
    source: KwSource;
    kwLokalu: string | null;
    kwGruntu: string | null;
    deweloperski: boolean;
    // Optional here for the same reason they are optional on `KwSnapshot`:
    // a draft saved before ADR-018 has none, and reads as "not examined".
    dataBadania?: string | null;
    dzial3?: KwDzialSnapshot | null;
    dzial4?: KwDzialSnapshot | null;
  } | null;
  /** Examination of the grunt's book (ADR-018) — its own snapshot, not part of `kw`. */
  kwGrunt?: KwGruntSnapshot | null;
  /** The appraiser's call on a dział III entry in the lokal's book (B-07). */
  encumbranceTreatment?: EncumbranceTreatment | null;
  provenance?: InputsProvenance | null;
  /**
   * Rodzaj prawa (T-12) — a valuation column, not part of `inputs`, so the
   * caller spreads it in. Absent = legacy caller = własność: the KW gruntu
   * blocker stays on (default-deny), exactly as before the block.
   */
  propertyRight?: PropertyRight;
  /** Prose snapshot (FR-6) — gated only when the caller asks for it, see `GateOptions`. */
  prose?: {
    sections: Partial<Record<ProseSection, Sourced<string>>>;
    /**
     * Per section: the facts THAT section's text was last generated from or
     * accepted against. Optional at the type level only because a row
     * persisted before this field existed carries no map at all — the adapter
     * normalizes that to `{}` on read, which makes every populated section
     * read stale (the promised migration behaviour).
     */
    factsHashes?: Partial<Record<ProseSection, string>>;
  } | null;
};

export type GateOptions = {
  /**
   * Whether the operat's descriptive sections are part of the invariant.
   * The app layer computes this from the NEXT_PUBLIC_PROSE kill switch and
   * passes it in — `domain/` reads no env (F-10). Omitted (every pre-FR-6
   * call site) means "don't gate prose", so the flag being off is
   * indistinguishable from the world before the feature existed.
   */
  requireProse?: boolean;
  /**
   * Whether B-01 is asked at all (M-1). Carries `NEXT_PUBLIC_PHOTO_UPLOAD`,
   * the same way `requireProse` carries FR-6: a build with photo upload
   * switched off cannot satisfy the blocker, so the switch removes the
   * requirement rather than wedging every draft. Absent means "do not ask" —
   * default-deny belongs to the data, not to a flag the caller forgot.
   */
  requirePhotos?: boolean;
  /**
   * Fingerprint of the draft's CURRENT facts PER SECTION, for comparison
   * against the ones the stored prose carries. Computed by the caller, never
   * here: the hash needs `node:crypto` (`domain/prose-hash.ts`) and this
   * module is imported from Client Components — same reason `now` is passed
   * into `approve`.
   *
   * Per section rather than one hash for the whole snapshot (T4): a single
   * fingerprint moved whenever ANY input moved, so correcting one transaction
   * price told the appraiser that all six descriptions — including the three
   * that only ever described the flat itself — now describe an earlier version
   * of the data. The blocker has to name the sections that actually changed,
   * or re-reading it becomes a ritual instead of a check.
   *
   * An absent entry means "the caller cannot tell", and staleness is then NOT
   * checked for that section: every production caller supplies all six (the
   * approve action, both server components, and the adapter computes its own
   * inside the write transaction), so inventing a blocker out of an absence
   * would only ever put a false sentence in front of the appraiser.
   */
  currentSectionHashes?: Partial<Record<ProseSection, string>>;
  /**
   * The logged-in appraiser's profile — the source of the author block and the
   * OC policy since ADR-020 cz. 1. `null` means "no profile row at all", which
   * is a complete answer and raises both B-15 and B-16.
   *
   * ABSENT means the caller could not tell, and the profile group is then not
   * checked — the `requireProse` precedent above. No production path can
   * produce that: `gateContextFor` takes the profile as a required argument,
   * so TypeScript refuses a call site that forgot it.
   */
  author?: AppraiserProfile | null;
  /**
   * The date the operat will carry — `approvedAt` at approval, today for the
   * step-7 preview. B-16 measures the policy against it, and the blocker names
   * it, so it cannot be derived here: the domain reads no clock (F-10).
   */
  today?: Date;
};

const SCALAR_KEYS = ["address", "area", "weights", "ratings"] as const;

const SCALAR_LABEL: Record<(typeof SCALAR_KEYS)[number], string> = {
  address: "Adres",
  area: "Powierzchnia",
  weights: "Wagi cech",
  ratings: "Oceny cech",
};

function statusLabel(status: ProvenanceStatus): string {
  return status === "to_verify" ? "do weryfikacji" : "brak prowenancji";
}

export function approvalGate(input: GateInput, options?: GateOptions): GateResult {
  const blockers: Blocker[] = [];

  if (input.comparables.length < REQUIRED_SAMPLE_SIZE) {
    blockers.push({
      path: "comparables",
      label: `Próba ma ${input.comparables.length} transakcji — wymagane co najmniej ${REQUIRED_SAMPLE_SIZE}.`,
    });
  }

  input.comparables.forEach((c, i) => {
    const source = isRegistrySourced(c) ? c.source : "rzeczoznawca";
    const status: ProvenanceStatus = c.status ?? "none";
    const s = sourced(c, source, status);
    if (isBlocking(s)) {
      const origin = isRegistrySourced(c) ? ` (${REGISTRY_LABEL[c.source]})` : "";
      blockers.push({
        path: `comparables[${i}]`,
        label: `Transakcja ${i + 1}${origin} — ${statusLabel(status)}.`,
      });
    }
  });

  for (const key of SCALAR_KEYS) {
    const entry = input.provenance?.[key];
    const s = sourced(key, entry?.source ?? "rzeczoznawca", entry?.status ?? "none");
    if (isBlocking(s)) {
      blockers.push({
        path: `provenance.${key}`,
        label: `${SCALAR_LABEL[key]} — ${statusLabel(entry?.status ?? "none")}.`,
      });
    }
  }

  // Rating-scale definitions (Slice 7): gated only when the snapshot carries
  // the key — legacy drafts (pre-preset) stay approvable unchanged.
  if (input.provenance?.featureDefs != null) {
    const fd = input.provenance.featureDefs;
    const s = sourced("featureDefs", fd.source, fd.status);
    if (isBlocking(s)) {
      blockers.push({
        path: "provenance.featureDefs",
        label: `Definicje skali ocen — ${statusLabel(fd.status)}.`,
      });
    }
  }

  if (input.sampleMeta != null) {
    const geocode = input.provenance?.geocode;
    const s = sourced("geocode", geocode?.source ?? "geokoder", geocode?.status ?? "none");
    if (isBlocking(s)) {
      blockers.push({
        path: "provenance.geocode",
        label: `Geokodowanie adresu — ${statusLabel(geocode?.status ?? "none")}.`,
      });
    }
  }

  // Subject data (EGiB/MPZP): gated whenever a subject snapshot exists.
  // Decision 10: confirmed "no plan" is also a conscious approval — mpzp group
  // covers both plan data and its absence.
  if (input.subject != null) {
    const ewidencja = input.provenance?.ewidencja;
    const sE = sourced("ewidencja", ewidencja?.source ?? "ewidencja", ewidencja?.status ?? "none");
    if (isBlocking(sE)) {
      blockers.push({
        path: "provenance.ewidencja",
        label: `Dane ewidencyjne przedmiotu (EGiB) — ${statusLabel(ewidencja?.status ?? "none")}.`,
      });
    }
    const mpzp = input.provenance?.mpzp;
    const sM = sourced("mpzp", mpzp?.source ?? "mpzp", mpzp?.status ?? "none");
    if (isBlocking(sM)) {
      blockers.push({
        path: "provenance.mpzp",
        label: `Przeznaczenie planistyczne (MPZP) — ${statusLabel(mpzp?.status ?? "none")}.`,
      });
    }
  }

  // B-02 (M-10, D-34) — asked OUTSIDE the `input.subject != null` guard, like
  // B-06 and for the same reason: the 14.09 valuation was entered by hand, had
  // no snapshot, and slipped past every check that lived inside the guard.
  //
  // All five parts, one blocker: §9 prints one sentence, and a sentence that
  // names a source it cannot identify — or identifies one without the symbol
  // read out of it — is what Aneta reported. Nothing here may be guessed; the
  // auto-fetch fills the MPZP branch, the Poznań prefill the plan ogólny one.
  if (!isPrzeznaczenieComplete(input.subject)) {
    blockers.push({
      path: "subject.przeznaczenieRodzaj",
      code: "B-02",
      label:
        "Uzupełnij przeznaczenie terenu: wskaż podstawę (MPZP, plan ogólny albo studium), " +
        "nazwę, uchwałę z datą i symbol.",
    });
  }

  // B-01, wąsko — tylko „Budynek z zewnątrz". Do 16.09 operat dawało się wydać
  // bez ani jednego zdjęcia, a od M-1 pierwsze zdjęcie tej sekcji JEST okładką.
  // Bez tej blokady slot okładki wychodziłby pusty i defekt D-01 wracałby po
  // cichu — dokładnie w postaci, w jakiej zobaczyła go Aneta. Pytane POZA
  // guardem na `inspection != null`, bo szkic, który nigdy nie dotknął kroku 2,
  // nie ma migawki wcale (ta sama pułapka co przy B-02 i B-06).
  if (options?.requirePhotos && !input.inspection?.photos?.budynekZewn?.length) {
    blockers.push({
      path: "inspection.photos.budynekZewn",
      code: "B-01",
      label:
        "Dodaj co najmniej jedno zdjęcie: Budynek z zewnątrz. " +
        "Pierwsze z nich trafia na okładkę operatu.",
    });
  }

  // Provenance of an attached snapshot — only meaningful once there is one.
  if (input.kw != null) {
    const kwProv = input.provenance?.kw;
    const sK = sourced(
      "kw",
      kwProv?.source ?? kwProvenanceSource(input.kw.source),
      kwProv?.status ?? "none",
    );
    if (isBlocking(sK)) {
      blockers.push({
        path: "provenance.kw",
        label: `Stan prawny (KW) — ${statusLabel(kwProv?.status ?? "none")}.`,
      });
    }
  }

  // B-06 — asked OUTSIDE the `input.kw != null` guard, which is the entire
  // point (ADR-018 reg. 3, I-13 U): the 14.09 valuation went the manual route,
  // attached no snapshot, and so slipped past a requirement that lived inside
  // the guard — while the operat still claimed both books had been examined.
  // One blocker, not three: the appraiser has one thing to do, on one screen.
  if (kwRequirements(input.propertyRight, input.kw, input.kwGrunt).brakBadania) {
    blockers.push({
      path: "kw.badanie",
      code: "B-06",
      label: "Uzupełnij badanie księgi wieczystej: KW lokalu, KW gruntu i datę badania.",
    });
  }

  // B-07 — an encumbrance in the lokal's dział III is not a blocker because it
  // is bad news; it is a blocker because the operat has to SAY how the figure
  // treats it, in §2, §3, §8.2 and §10.1 (ADR-018 reg. 6).
  if (encumbranceDecisionNeeded(input.kw, input.encumbranceTreatment)) {
    blockers.push({
      path: "encumbranceTreatment",
      code: "B-07",
      label:
        "Księga zawiera ograniczone prawo rzeczowe — wskaż, czy wartość je uwzględnia, i podaj podstawę.",
    });
  }

  // Prose (FR-6 / ADR-014): no operat leaves without descriptions the
  // appraiser has read and accepted. Kept LAST so the pre-FR-6 groups keep
  // owning `blockers[0]` — the action shows only the first one.
  //
  // Every one of the six sections is required, not just the ones today's
  // facts could back: a section the automat skips (no inspection note) is
  // one the appraiser writes by hand, and step 6 offers all six editors.
  // A blank field is a conscious "this is not in the operat" (it REMOVES
  // the section, see `confirmProseSnapshot`) — and the gate must see that
  // as an unfilled section, because the document would print nothing there.
  if (options?.requireProse) {
    if (!input.prose) {
      blockers.push({ path: "prose", label: "Opisy sekcji nie zostały wygenerowane." });
    } else {
      for (const section of PROSE_SECTIONS) {
        const entry = input.prose.sections[section];
        const label = PROSE_SECTION_LABEL[section];
        if (!entry?.value?.trim()) {
          // Covers the tampering case too: text deleted (or never written)
          // while the provenance still claims "confirmed".
          blockers.push({ path: `prose.${section}`, label: `${label} — brak tekstu.` });
          continue;
        }
        const status: ProvenanceStatus = entry.provenance?.status ?? "none";
        if (isBlocking(sourced(entry.value, entry.provenance?.source ?? "ai", status))) {
          blockers.push({ path: `prose.${section}`, label: `${label} — ${statusLabel(status)}.` });
          continue;
        }
        // Staleness (T6 review, I-2; per section since T4). `confirmed`
        // records that the appraiser accepted the text — not WHICH data the
        // text describes. Edit the sample after step 6 and the affected
        // sections stay confirmed while their sentences describe a sample
        // that no longer exists; `uzasadnienie` is literally the result's
        // standing against that sample. The engine's own answer to the same
        // problem is `wr: null` after such an edit (step 5 must be redone);
        // this is the prose half of it.
        //
        // Reached only for a section that already cleared the status check,
        // so each section contributes at most ONE blocker: an unaccepted
        // section is `do weryfikacji` and nothing more, since re-reading it
        // is the same remedy either way.
        //
        // This is the SECOND of two independent defences. The first is the
        // merge (`mergeProseProposal`), which demotes an appraiser's section
        // back to `to_verify` when its facts move — but that only happens on
        // a regeneration, and nothing forces one before approval. The gate
        // must not depend on it having run: stale prose under a signature is
        // the failure this whole slice exists to prevent.
        const current = options.currentSectionHashes?.[section];
        if (current && input.prose.factsHashes?.[section] !== current) {
          blockers.push({
            path: `prose.${section}`,
            label: `${label} — dane się zmieniły, przejrzyj ponownie.`,
          });
        }
      }
    }
  }

  return blockers.length === 0 ? { ok: true } : { ok: false, blockers };
}
