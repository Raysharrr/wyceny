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
import type { Candidate } from "@/domain/sample-selection";
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
  const [mode, setMode] = useState<Mode>(entry?.panoId && streetViewUsable ? "street" : "orto");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<ManualRejectionReason | null>(null);
  const [note, setNote] = useState("");

  const caption = !streetViewUsable
    ? "Podgląd Street View jest wyłączony (brak klucza Maps Embed)."
    : entry?.captureDate
      ? `zdjęcie Google z ${entry.captureDate}`
      : "brak zdjęcia ulicy";

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      onClose();
      return;
    }
    if (e.key !== "Enter") return;
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
    // "Zostaw" already fires `onKeep` natively on Enter (a focused
    // <button> does) — this branch only promotes Enter to "next" when
    // focus is somewhere else in the panel, so it never double-fires.
    if (target.tagName === "BUTTON" && target.dataset.keep !== "true") return;
    if (target.dataset.keep === "true") return;
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
          alt="Ortofotomapa GUGiK (podgląd)"
          src={ortoWmsUrl(pos)}
          onError={(e) => {
            e.currentTarget.src = kiegWmsUrl(pos);
          }}
          className="aspect-square w-full rounded-lg border object-cover"
        />
      );
    }
    if (!streetViewUsable) return null; // caption above already explains why; both tabs are disabled
    if (!entry) {
      return (
        <p className="text-sm text-muted-foreground">brak danych podglądu dla tego budynku.</p>
      );
    }
    if (mode === "street") {
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
          <p className="text-sm text-muted-foreground">{caption}</p>

          <div className="flex flex-col gap-1.5">
            <div role="tablist" className="inline-flex gap-1">
              <Button
                type="button"
                size="sm"
                variant={mode === "street" ? "default" : "outline"}
                disabled={!streetViewUsable}
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
            <Field label="Rynek">{candidate.market ?? "nieznany"}</Field>
            <Field label="Sprzedający">{sellerLabel(candidate.seller)}</Field>
            <Field label="Udział">{candidate.share}</Field>
            <Field label="Obręb">{obrebLabel(candidate.egib)}</Field>
            <Field label="Działka · budynek">
              {candidate.egib?.dzialka ?? "—"} · bud. {candidate.egib?.budynek ?? "—"}
            </Field>
            <Field label="Odległość">{Math.round(candidate.distanceM)} m</Field>
          </dl>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="default"
              className="flex-1"
              data-keep="true"
              onClick={onKeep}
            >
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
                do snapshotu i do prozy „analiza rynku”.
              </p>
            </div>
          ) : null}
        </div>
      </SectionCard>
    </div>
  );
}
