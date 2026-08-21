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
  type ManualRejectionReason,
} from "@/domain/sample-manual";
import { obrebLabel } from "@/domain/obreb-name";
import { candidateKey, type Candidate } from "@/domain/sample-selection";
import type { StreetViewEntry } from "@/domain/street-view-snapshot";
import { kiegWmsUrl, mapEmbedUrl, ortoWmsUrl, streetViewEmbedUrl } from "./embed-urls";

export type SamplePanelProps = {
  candidate: Candidate;
  index: number;
  total: number;
  entry: StreetViewEntry | undefined;
  embedKey: string | null;
  streetViewEnabled: boolean;
  isProposed: boolean;
  onKeep(): void;
  onReject(r: { reason: ManualRejectionReason; note?: string }): void;
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
  isProposed,
  onKeep,
  onReject,
  onClose,
}: SamplePanelProps) {
  const streetViewUsable = Boolean(embedKey) && streetViewEnabled;
  // Google has no panorama for this building (or enrichment never ran for
  // it) — distinct from `!streetViewUsable` (no key/feature flag): here the
  // KEY works fine, there's just nothing to show on the "Ulica" tab.
  const noPanorama = !entry || entry.panoId === null;

  const [forKey, setForKey] = useState(candidateKey(candidate));
  const [mode, setMode] = useState<Mode>(initialMode(entry, streetViewUsable));
  const [rejecting, setRejecting] = useState(false);
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
    setRejecting(false);
    setReason(null);
    setNote("");
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
    // Any focused BUTTON — including "Zostaw" itself — already answers
    // Enter natively with its own click, so every button is excluded here;
    // this only promotes Enter to "next" when focus is somewhere else in
    // the panel, never double-firing `onKeep`.
    if (target.tagName === "BUTTON") return;
    onKeep();
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
        title={`Kandydatka ${index + 1} z ${total}`}
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
          {isProposed === false ? <Badge variant="outline">alternatywa</Badge> : null}

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
            <p className="text-xs text-muted-foreground">
              ↑ ↓ zmiana kandydatki · Enter = następna
            </p>
          </div>

          <dl className="text-sm">
            <Field label="Data transakcji">{candidate.date || "—"}</Field>
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

          {rejecting ? (
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
              <p className="text-xs text-muted-foreground">
                Odrzucona kandydatka wypada z propozycji, następna alternatywa wchodzi. Powód trafia
                do zapisu wyceny (snapshot) — proza „analiza rynku” go na razie nie czyta.
              </p>
            </div>
          ) : null}
        </div>
      </SectionCard>
    </div>
  );
}
