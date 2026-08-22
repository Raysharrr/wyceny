"use client";

import { useState } from "react";
import { Building2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/wizard/section-card";
import {
  MANUAL_REJECTION_LABELS,
  MANUAL_REJECTION_REASONS,
  type ManualRejection,
  type ManualRejectionReason,
} from "@/domain/sample-manual";
import { obrebLabel } from "@/domain/obreb-name";
import type { StreetIndexState } from "@/ports/sample";
import { streetMissingReason, streetMissingTitle } from "./sample-badges";
import { candidateKey, DEFAULTS, type Candidate } from "@/domain/sample-selection";
import type { StreetViewEntry } from "@/domain/street-view-snapshot";
import { kiegWmsUrl, mapEmbedUrl, ortoWmsUrl, streetViewEmbedUrl } from "./embed-urls";

export type SamplePanelProps = {
  /** Stan indeksu adresów z chwili pobrania puli (Slice 3d) — decyduje, jak wyjaśnić kreskę. */
  streetIndex?: StreetIndexState;
  candidate: Candidate;
  index: number;
  total: number;
  entry: StreetViewEntry | undefined;
  embedKey: string | null;
  streetViewEnabled: boolean;
  /** Which section this candidate currently sits in — drives the action buttons and the top badge (Task 4). */
  status: "proposed" | "alternate" | "rejected";
  /**
   * Pre-opens the rejection-reasons block immediately, skipping the extra
   * "Odrzuć" click — the checkbox-uncheck path (`SampleSections`'s "w
   * próbie" checkbox on a proposed row, Task 5). Only meaningful for
   * `status: "proposed"`. Applies to the CANDIDATE it was passed for only —
   * switching to a different candidate resets it like every other
   * per-candidate state (see the `forKey` reset below).
   */
  initialRejecting?: boolean;
  /** The candidate's own manual rejection (reason + optional note) — only present for `status: "rejected"`. */
  rejection?: ManualRejection;
  /** "przejrzane N" in the title (Task 5, `reviewStats.reviewed` at the caller) — appended only when passed, so every pre-Task-5 unit test's plain "Propozycja i z M" assertion keeps matching. */
  reviewedCount?: number;
  onKeep(): void;
  onReject(r: { reason: ManualRejectionReason; note?: string }): void;
  /** "Dodaj do próby" (status: "alternate") — adds this candidate to `manualInclusions` (Task 5 wiring: `include(key)`). */
  onInclude(): void;
  /** "Pomiń" (status: "alternate") — marks the row reviewed and advances, without adding it (Task 5 wiring: `skip(key)` + `next()`). */
  onSkip(): void;
  /** "Przywróć" (status: "rejected") — drops the manual rejection (Task 5 wiring: `restore(m)`). */
  onRestore(): void;
  /** "Anuluj" inside the rejection-reasons block (Task 5) — lets the caller clear its own `panelInitialRejecting` so the SAME row doesn't reopen the reasons block if it's re-selected later. Purely a notification; the block itself always closes locally regardless of whether this is passed. */
  onCancelRejecting?(): void;
  onClose(): void;
};

type Mode = "street" | "map" | "orto";

const pln = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const m2 = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function sellerLabel(seller: string | null): string {
  if (seller === "osobaPrawna") return "osoba prawna";
  if (seller === "osobaFizyczna") return "osoba fizyczna";
  return "—";
}

/** Raw RCN market value → Polish label (final wave minor i) — "wtorny" has no diacritic in the source data. */
function marketLabel(market: Candidate["market"]): string {
  if (market === "wtorny") return "wtórny";
  if (market === "pierwotny") return "pierwotny";
  return "nieznany";
}

function initialMode(entry: StreetViewEntry | undefined, streetViewUsable: boolean): Mode {
  return entry?.panoId && streetViewUsable ? "street" : "orto";
}

/**
 * The keyboard hint under the mode tabs — status-aware (Task 4 fix round
 * 1): Enter's action differs per status (`mainAction`, below), and ↑/↓ is a
 * no-op for a rejected row (its key isn't in `SampleTable`'s `allKeys` — see
 * that file's `move()` doc comment), so the hint drops the "↑ ↓" part
 * entirely for `rejected` rather than promise navigation that doesn't work.
 */
function keyboardHint(status: SamplePanelProps["status"]): string {
  if (status === "alternate") return "↑ ↓ zmiana propozycji · Enter = Dodaj do próby";
  if (status === "rejected") return "Enter = Przywróć";
  return "↑ ↓ zmiana propozycji · Enter = następna";
}

/** One record field row — `dl`/`dt`/`dd` (as `flex` divs, since `dl` doesn't lay children out on its own). */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="num text-right">{children}</dd>
    </div>
  );
}

/**
 * Step-3 side panel (spec §Krok 3 UI, artboard "Krok 3 po Slice 3"): Street
 * View / map / orthophoto preview for one candidate, its record fields, and
 * the appraiser's Zostaw/Odrzuć decision. Purely presentational — props in,
 * callbacks out; no form, no Server Action (that lives in the caller, Task 7).
 */
export function SamplePanel({
  candidate,
  index,
  total,
  entry,
  embedKey,
  streetViewEnabled,
  streetIndex,
  status,
  initialRejecting = false,
  rejection,
  reviewedCount,
  onKeep,
  onReject,
  onInclude,
  onSkip,
  onRestore,
  onCancelRejecting,
  onClose,
}: SamplePanelProps) {
  const streetViewUsable = Boolean(embedKey) && streetViewEnabled;
  // Google has no panorama for this building (or enrichment never ran for
  // it) — distinct from `!streetViewUsable` (no key/feature flag): here the
  // KEY works fine, there's just nothing to show on the "Ulica" tab.
  const noPanorama = !entry || entry.panoId === null;

  const [forKey, setForKey] = useState(candidateKey(candidate));
  const [mode, setMode] = useState<Mode>(initialMode(entry, streetViewUsable));
  const [rejecting, setRejecting] = useState(initialRejecting);
  const [reason, setReason] = useState<ManualRejectionReason | null>(null);
  const [note, setNote] = useState("");

  // Derived-state-from-props reset (React's documented pattern for
  // resetting state when the "identity" a component represents changes),
  // rather than relying on the integrator remounting us with a `key=` prop.
  // setState during RENDER is safe here — React re-renders immediately with
  // the new state before anything commits to the DOM, so switching
  // candidates never lets a stale "reason"/"note" flash on screen for one
  // frame the way a `useEffect`-based reset (which runs AFTER commit) would.
  const currentKey = candidateKey(candidate);
  if (currentKey !== forKey) {
    setForKey(currentKey);
    setMode(initialMode(entry, streetViewUsable));
    // `initialRejecting` is read fresh for the NEW candidate's render — the
    // caller only ever sets it `true` for the one candidate it applies to
    // (e.g. `panelInitialRejecting === selectedKey`, Task 5), so a
    // candidate it wasn't passed for correctly resets to closed here.
    setRejecting(initialRejecting);
    setReason(null);
    setNote("");
  }

  // Re-open sync (Opus review round 1, I1): the block above only reacts to
  // a CANDIDATE change (`currentKey !== forKey`) — it misses a false→true
  // flip of `initialRejecting` on the SAME candidate (uncheck A while the
  // panel is already open on A; or uncheck A again after "Anuluj" closed
  // it). Tracks the LAST `initialRejecting` value acted on and re-opens
  // (with a fresh reason/note) whenever the caller's prop actually changes,
  // regardless of whether the candidate did. Render-phase, same pattern as
  // the block above — not `useEffect` (an extra commit/paint before it
  // runs) and not a `key={selectedKey}` remount (would also reset mode/
  // street-view-tab state on every ordinary re-select, not just this one).
  const [rejectingRequested, setRejectingRequested] = useState(initialRejecting);
  if (initialRejecting !== rejectingRequested) {
    setRejectingRequested(initialRejecting);
    if (initialRejecting) {
      setRejecting(true);
      setReason(null);
      setNote("");
    }
  }

  /** "Anuluj" (Task 5) — closes the reasons block locally (never rejects) and notifies the caller so a `panelInitialRejecting` pointed at this row doesn't reopen it later. Also clears `reason`/`note`, same as switching candidates does — an aborted rejection shouldn't leave a half-filled form behind. */
  function handleCancelRejecting() {
    setRejecting(false);
    setReason(null);
    setNote("");
    onCancelRejecting?.();
  }

  /** Enter's default action (no button/input focused) — the status's own primary action (Task 4). */
  function mainAction(): () => void {
    if (status === "alternate") return onInclude;
    if (status === "rejected") return onRestore;
    return onKeep;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      onClose();
      return;
    }
    if (e.key !== "Enter") return;
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
      // Never let Enter here fall through to the surrounding step form's
      // native submit (I2, final wave addendum) — without this, Enter in
      // the note field or on a reason radio would save the step and jump
      // to step 4, silently losing the in-progress rejection.
      e.preventDefault();
      // Bonus: Enter in the rejection note WITH a reason already picked, or
      // on the reason radio that's actually CHECKED (wave 3C — an
      // unchecked radio mid-navigation must not confirm), reads as "I'm
      // done" — the same action "Potwierdź odrzucenie" does. A checked
      // radio's `checked` DOM property is controlled by `reason === r`
      // above, so checking it here is equivalent to `reason === value` but
      // needs no extra state read.
      const input = target as HTMLInputElement;
      const isNote = input.id === "reject-note";
      const isCheckedRadio = input.type === "radio" && input.checked;
      if (reason && (isNote || isCheckedRadio)) {
        onReject({ reason, ...(note.trim() ? { note: note.trim() } : {}) });
      }
      return;
    }
    // Any focused BUTTON — including "Zostaw"/"Dodaj do próby"/"Przywróć"
    // themselves — already answers Enter natively with its own click, so
    // every button is excluded here; this only promotes Enter to the
    // status's main action when focus is somewhere else in the panel,
    // never double-firing it.
    if (target.tagName === "BUTTON") return;
    mainAction()();
  }

  function renderPreview() {
    if (mode === "orto") {
      if (!candidate.pos) {
        return <p className="text-sm text-muted-foreground">brak współrzędnych</p>;
      }
      const pos = candidate.pos;
      return (
        // eslint-disable-next-line @next/next/no-img-element -- WMS tile, not an optimizable static asset
        <img
          // Remounts on candidate change: the one-shot `data-fallback`
          // marker below lives on THIS DOM node, and without a key React
          // would reuse the same node across candidates (mode stays
          // "orto") — candidate A's ORTO failure would leave the marker
          // set, so candidate B's OWN ORTO failure gets silently ignored
          // and B stays stuck on a broken image. A fresh `key` forces a
          // fresh node (fresh marker, fresh `src`) per candidate.
          key={candidateKey(candidate)}
          alt="Ortofotomapa GUGiK (podgląd)"
          src={ortoWmsUrl(pos)}
          onError={(e) => {
            // One-shot: ORTO's own error already fired once and swapped us
            // to KIEG below — a SECOND error (KIEG also down, or the
            // browser retrying) must not loop back to ORTO again.
            if (e.currentTarget.dataset.fallback) return;
            e.currentTarget.dataset.fallback = "1";
            e.currentTarget.src = kiegWmsUrl(pos);
          }}
          className="aspect-square w-full rounded-lg border object-cover"
        />
      );
    }
    if (!streetViewUsable) return null; // caption above already explains why; both tabs are disabled
    if (mode === "street") {
      // "Ulica" is disabled whenever `noPanorama`, so this is unreachable
      // in normal use — guarded rather than risking a broken iframe if
      // `mode` is ever driven some other way. The Street View iframe must
      // never render for a building with no panorama. (Checked directly on
      // `entry` rather than via the `noPanorama` variable so TypeScript can
      // narrow `entry` to defined below.)
      if (!entry || entry.panoId === null) return null;
      return (
        <iframe
          title="Street View"
          src={streetViewEmbedUrl(embedKey!, entry)}
          className="aspect-[4/3] w-full rounded-lg border"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
        />
      );
    }
    // mode === "map" — works from `entry`'s lat/lng even without a
    // panorama (a plain satellite view by location), so only a
    // completely missing entry needs a fallback here.
    if (!entry) {
      return (
        <p className="text-sm text-muted-foreground">brak danych podglądu dla tego budynku.</p>
      );
    }
    return (
      <iframe
        title="Mapa"
        src={mapEmbedUrl(embedKey!, entry)}
        className="aspect-[4/3] w-full rounded-lg border"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
      />
    );
  }

  return (
    <div onKeyDown={handleKeyDown}>
      <SectionCard
        icon={Building2}
        // A rejected row isn't in the proposed/alternate ranking (`index`
        // is -1 there — it's not in `combined`, see `step-sample.tsx`'s
        // `panelStatus` derivation), so "Propozycja N z M" would misprint
        // "Propozycja 0 z M" — a distinct, non-ranked title instead.
        title={
          status === "rejected"
            ? "Odrzucona propozycja"
            : `Propozycja ${index + 1} z ${total}` +
              (reviewedCount !== undefined ? ` · przejrzane ${reviewedCount}` : "")
        }
        right={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Zamknij podgląd"
            onClick={onClose}
          >
            <X />
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          {status !== "proposed" ? (
            <Badge variant="outline">{status === "alternate" ? "alternatywa" : "odrzucona"}</Badge>
          ) : null}

          {renderPreview()}
          {!streetViewUsable ? (
            <p className="text-sm text-muted-foreground">
              Podgląd Street View jest wyłączony (brak klucza Maps Embed).
            </p>
          ) : noPanorama ? (
            // Visible in EVERY mode (not just "street") — it's the reason
            // the panel opened on Ortofoto in the first place. Two distinct
            // states (M6, final wave addendum): NO entry at all (enrichment
            // skipped/failed) reads "brak miniaturki", same wording as the
            // table's dashed box; an entry whose `panoId` is null (Google
            // confirmed no panorama there) reads "brak zdjęcia ulicy" — no
            // capture-date suffix (M3: `panoId === null` always means
            // `captureDate === null` too, so that suffix could never show).
            <p className="text-sm text-muted-foreground">
              {entry ? "brak zdjęcia ulicy" : "brak miniaturki"}
            </p>
          ) : mode === "street" ? (
            <p className="text-sm text-muted-foreground">
              {entry?.captureDate ? `zdjęcie Google z ${entry.captureDate}` : "brak zdjęcia ulicy"}
            </p>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <div role="tablist" className="inline-flex gap-1">
              <Button
                type="button"
                size="sm"
                variant={mode === "street" ? "default" : "outline"}
                disabled={!streetViewUsable || noPanorama}
                onClick={() => setMode("street")}
              >
                Ulica
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "map" ? "default" : "outline"}
                disabled={!streetViewUsable}
                onClick={() => setMode("map")}
              >
                Mapa
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "orto" ? "default" : "outline"}
                onClick={() => setMode("orto")}
              >
                Ortofoto
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{keyboardHint(status)}</p>
          </div>

          <dl className="text-sm">
            <Field label="Data transakcji">{candidate.date || "—"}</Field>
            <Field label="Adres">
              {(() => {
                // Adres z eksportu GEOPOZ (Slice 3d) — z numerem, bo rzeczoznawca
                // porównuje go tu z panoramą obok; do operatu idzie sama nazwa (F-12).
                const reason = streetMissingReason(candidate, streetIndex);
                return reason ? (
                  <span title={streetMissingTitle(reason, streetIndex?.cutoff ?? null)}>—</span>
                ) : (
                  [candidate.street, candidate.streetNumber].filter(Boolean).join(" ")
                );
              })()}
            </Field>
            <Field label="Cena">{pln.format(candidate.priceTotal)} zł</Field>
            <Field label="Cena za m²">{pln.format(candidate.pricePerM2)} zł/m²</Field>
            <Field label="Powierzchnia">{m2.format(candidate.area)} m²</Field>
            <Field label="Piętro / izby">
              {candidate.floor ?? "—"} / {candidate.rooms ?? "—"}
            </Field>
            <Field label="Rynek">{marketLabel(candidate.market)}</Field>
            <Field label="Sprzedający">{sellerLabel(candidate.seller)}</Field>
            <Field label="Udział">{candidate.share}</Field>
            <Field label="Obręb">{obrebLabel(candidate.egib)}</Field>
            <Field label="Działka · budynek">
              {candidate.egib?.dzialka ?? "—"} · bud. {candidate.egib?.budynek ?? "—"}
            </Field>
            <Field label="Odległość">{Math.round(candidate.distanceM)} m</Field>
          </dl>

          {status === "proposed" ? (
            <div className="flex gap-2">
              <Button type="button" variant="default" className="flex-1" onClick={onKeep}>
                Zostaw
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setRejecting(true)}
              >
                Odrzuć
              </Button>
            </div>
          ) : status === "alternate" ? (
            <>
              <div className="flex gap-2">
                <Button type="button" variant="default" className="flex-1" onClick={onInclude}>
                  Dodaj do próby
                </Button>
                <Button type="button" variant="outline" className="flex-1" onClick={onSkip}>
                  Pomiń
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Dodana alternatywa wchodzi do próby obok dotychczasowych — próba może mieć więcej
                niż {DEFAULTS.proposedN} transakcji.
              </p>
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <Button type="button" variant="default" onClick={onRestore}>
                Przywróć
              </Button>
              {rejection ? (
                <div className="rounded-lg border p-3 text-sm">
                  <p>
                    <span className="text-muted-foreground">Powód odrzucenia: </span>
                    {MANUAL_REJECTION_LABELS[rejection.reason]}
                  </p>
                  {rejection.note ? (
                    <p className="text-muted-foreground">„{rejection.note}”</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}

          {status === "proposed" && rejecting ? (
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex flex-col gap-1.5">
                {MANUAL_REJECTION_REASONS.map((r) => (
                  <label key={r} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="reject-reason"
                      value={r}
                      checked={reason === r}
                      onChange={() => setReason(r)}
                    />
                    {MANUAL_REJECTION_LABELS[r]}
                  </label>
                ))}
              </div>
              <Input
                id="reject-note"
                placeholder="notatka (opcjonalnie)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={!reason}
                  onClick={() =>
                    reason && onReject({ reason, ...(note.trim() ? { note: note.trim() } : {}) })
                  }
                >
                  Potwierdź odrzucenie
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={handleCancelRejecting}>
                  Anuluj
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Odrzucona propozycja wypada z próby, następna alternatywa wchodzi. Powód trafia do
                zapisu wyceny (snapshot) — proza „analiza rynku” go na razie nie czyta.
              </p>
            </div>
          ) : null}
        </div>
      </SectionCard>
    </div>
  );
}
