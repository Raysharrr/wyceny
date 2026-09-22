"use client";

import { ArrowUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/wizard/section-card";
import { LEVEL_LABEL } from "@/domain/feature-presets";
import { describedLevels } from "@/domain/feature-rules";
import {
  suggestedRating,
  type ExtremeLokal,
  type ExtremeSide,
  type RatingSuggestion,
} from "@/domain/extremes";
import type { ComparableRatings, Feature, FeatureRating } from "@/domain/kcs";
import { pietroOfFloor } from "@/domain/sample-selection";
import { cn } from "@/lib/utils";
import { FeatureRatingGroup } from "./feature-rating-group";
import { boundText } from "./feature-hint-text";

/** Cecha tak, jak widzi ją karta lokali: klucz obowiązkowy (bez klucza nie ma gdzie trzymać oceny). */
export type ExtremeFeature = Pick<Feature, "name" | "definitions" | "measure"> & { key: string };

const SIDE_TITLE: Record<ExtremeSide, string> = {
  max: "Cena najwyższa w próbie",
  min: "Cena najniższa w próbie",
};
const SIDE_GENITIVE: Record<ExtremeSide, string> = { max: "najwyższej", min: "najniższej" };

const priceFormatter = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" });
const areaFormatter = new Intl.NumberFormat("pl-PL", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** „parter” / „3. piętro” po konwersji kondygnacji RCN; null, gdy rejestr nie podał. */
export function pietroText(lokal: ExtremeLokal): string | null {
  const pietro = pietroOfFloor(lokal.candidate?.floor, lokal.comparable.source);
  if (pietro == null) return null;
  return pietro === 0 ? "parter" : `${pietro}. piętro`;
}

/** „03.2026” z daty transakcji (YYYY-MM lub pełna ISO) — miesiąc, nigdy dzień (F-12). */
export function monthText(date: string | undefined): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(date ?? "");
  return m ? `${m[2]}.${m[1]}` : null;
}

/** Czy lokal ma ocenę na OPISANYM poziomie dla każdej cechy aktywnej. */
export function isLokalRated(
  features: ExtremeFeature[],
  ratings: Record<string, FeatureRating> | undefined,
): boolean {
  return features.every((f) => {
    const rating = ratings?.[f.key];
    return rating != null && describedLevels(f).includes(rating);
  });
}

/** Mockup `ThresholdHint` dla lokalu skrajnego — każda liczba pochodzi z rejestru i z progów rzeczoznawcy. */
function ExtremeHint({
  suggestion,
  testId,
  onAccept,
}: {
  suggestion: RatingSuggestion;
  testId: string;
  onAccept: () => void;
}) {
  const poziom = <b>{LEVEL_LABEL[suggestion.level]}</b>;
  let text: React.ReactNode;
  if (suggestion.source === "pomieszczenia przynależne") {
    text = suggestion.annex ? (
      <>Podpowiedź: rejestr biura podaje pomieszczenie przynależne (P.P: tak) → {poziom}</>
    ) : (
      <>Podpowiedź: rejestr biura nie podaje pomieszczenia przynależnego (P.P: nie) → {poziom}</>
    );
  } else {
    const kind = suggestion.source === "piętro" ? "floor" : "area";
    const prog = boundText(kind, suggestion.bound);
    const rounded = Math.round(suggestion.value);
    const wartosc =
      kind === "floor" ? String(suggestion.value) : `${areaFormatter.format(suggestion.value)} m²`;
    const zaokraglona = kind === "area" && rounded !== suggestion.value ? `${rounded} m²` : null;
    text = (
      <>
        Podpowiedź:{" "}
        {kind === "floor" && suggestion.value === 0 ? (
          "parter"
        ) : (
          <>
            {suggestion.source} lokalu <b>{wartosc}</b>
            {zaokraglona ? (
              <>
                {" ≈ "}
                <b>{zaokraglona}</b>
              </>
            ) : null}
          </>
        )}{" "}
        (rejestr) · próg „{LEVEL_LABEL[suggestion.level]}”{prog.slowo ? ` ${prog.slowo}` : ""}{" "}
        <b>{prog.liczba}</b> → {poziom}
      </>
    );
  }
  return (
    <div
      data-testid={testId}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashed border-[var(--amber-line)] bg-card px-3 py-2 text-[12.5px]"
    >
      <span>{text}</span>
      <Button type="button" variant="outline" size="xs" onClick={onAccept}>
        Przyjmij
      </Button>
    </div>
  );
}

/**
 * Druga karta kroku 4 (ADR-022, makieta 7): lokale o cenie najwyższej i
 * najniższej z próby, każdy z wierszem per cecha aktywna — kafelki kompaktowe
 * tylko dla poziomów opisanych, podpowiedź tam, gdzie rejestr ma dane. Stan
 * ocen trzyma formularz kroku (`comparableRatings`); tu tylko render i klik.
 */
export function ExtremesCard({
  lokale,
  features,
  ratings,
  onRate,
}: {
  lokale: Array<ExtremeLokal & { side: ExtremeSide }>;
  features: ExtremeFeature[];
  ratings: ComparableRatings;
  onRate: (lokalKey: string, featureKey: string, level: FeatureRating) => void;
}) {
  const rated = lokale.filter((l) => isLokalRated(features, ratings[l.key])).length;
  return (
    <SectionCard
      icon={ArrowUpDown}
      title="Lokale o cenie skrajnej"
      sub={`oceniono ${rated} z ${lokale.length} · operat opisuje je w §12.2 Twoimi ocenami`}
      data-testid="extremes-card"
    >
      <div className="-mx-5 -mb-5 -mt-5 flex flex-col">
        {lokale.map((lokal, n) => {
          const perLokal = ratings[lokal.key];
          const lokalRated = isLokalRated(features, perLokal);
          const area = lokal.comparable.area ?? lokal.candidate?.area ?? null;
          const pietro = pietroText(lokal);
          const month = monthText(lokal.comparable.date ?? lokal.candidate?.date);
          return (
            <div
              key={lokal.key}
              data-testid={`extreme-lokal-${n}`}
              data-rated={lokalRated}
              className="flex flex-col border-t border-border first:border-t-0"
            >
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-muted px-5 py-3.5">
                <span className="text-sm font-semibold">{SIDE_TITLE[lokal.side]}</span>
                <span className="flex flex-wrap gap-2.5 text-[12.5px] text-muted-foreground">
                  <span className="num">{priceFormatter.format(lokal.pricePerM2)}/m²</span>
                  {lokal.candidate?.street ? <span>{lokal.candidate.street}</span> : null}
                  {area != null ? (
                    <span className="num">{areaFormatter.format(area)} m²</span>
                  ) : null}
                  {pietro ? <span>{pietro}</span> : null}
                  {month ? <span>transakcja {month}</span> : null}
                </span>
                {!lokalRated ? (
                  <Badge
                    variant="outline"
                    className="border-[var(--amber-line)] text-[var(--amber)]"
                  >
                    Oceń cechy
                  </Badge>
                ) : null}
              </div>
              {features.map((feature) => {
                const levels = describedLevels(feature);
                const current = perLokal?.[feature.key];
                const rating = current != null && levels.includes(current) ? current : null;
                const suggestion = suggestedRating(feature, lokal);
                return (
                  <div
                    key={feature.key}
                    data-testid={`extreme-row-${n}-${feature.key}`}
                    data-rated={rating != null}
                    className={cn(
                      "grid grid-cols-[200px_1fr] items-start gap-x-4 gap-y-2 border-t border-border px-5 py-2.5",
                      rating == null && "bg-[var(--amber-bg)]",
                    )}
                  >
                    <span className="pt-2 text-sm font-medium">{feature.name}</span>
                    <div className="flex flex-col gap-2">
                      <FeatureRatingGroup
                        compact
                        label={`${feature.name} — lokal o cenie ${SIDE_GENITIVE[lokal.side]}`}
                        levels={levels}
                        definitions={feature.definitions ?? undefined}
                        rating={rating}
                        onSelect={(level) => onRate(lokal.key, feature.key, level)}
                      />
                      {suggestion && suggestion.level !== rating ? (
                        <ExtremeHint
                          suggestion={suggestion}
                          testId={`extreme-hint-${n}-${feature.key}`}
                          onAccept={() => onRate(lokal.key, feature.key, suggestion.level)}
                        />
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
