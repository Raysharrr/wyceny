import { comparableContentKey } from "./kcs";
import type {
  Comparable,
  ComparableRatings,
  Feature,
  FeatureMeasure,
  FeatureRating,
  KcsInput,
  MeasureBound,
} from "./kcs";
import { describedLevels, levelForValue } from "./feature-rules";
import { candidateKey, pietroOfFloor, type Candidate } from "./sample-selection";

/**
 * Lokale o cenie skrajnej (ADR-022, refaktor R4). Jedno miejsce odpowiada na
 * pytanie „które wiersze próby mają cenę najniższą i najwyższą, i jaki
 * kandydat za nimi stoi” — czytają je §12.2 (`document-model.ts`), krok 4
 * (karta ocen) i bramka B-18 (`valuation.ts`). Czysty moduł (F-10).
 */

export type ExtremeSide = "min" | "max";

export type ExtremeLokal = {
  /**
   * Klucz ocen w `inputs.comparableRatings`: `candidateKey` (transactionId|lokalId)
   * dla wierszy z rejestru; `manual:<data|powierzchnia|cena>` (`comparableContentKey`)
   * dla wiersza wpisanego ręcznie, który nie ma żadnego identyfikatora.
   *
   * NIGDY pozycja w tablicy `comparables`. Pozycja nie jest tożsamością:
   * usunięcie wcześniejszego wiersza w kroku 3 przesuwa indeks, a mapa ocen
   * zostaje nietknięta — §12.2 wydrukowałby wtedy dla jednego lokalu ocenę,
   * którą rzeczoznawca wystawił INNEMU (recenzja całości bloku, F1). Ta sama
   * reguła, z tego samego powodu, rządzi `comparableKey` w `domain/valuation.ts`.
   */
  key: string;
  comparable: Comparable;
  /** Kandydat z migawki próby (join `candidateOf`, tylko dopasowanie DOKŁADNE); null dla wierszy ręcznych i legacy. */
  candidate: Candidate | null;
  pricePerM2: number;
};

export type Extremes = { min: ExtremeLokal[]; max: ExtremeLokal[] };

/**
 * The sample candidate a comparable row came from, and whether the join is
 * EXACT (R-7). Primary key: transactionId + lokalId (`candidateKey`) — one
 * notarial act can carry SEVERAL lokale (runtime bug, team-lead 2026-08-21,
 * Heweliusza 3/43: a transactionId-only join printed the SAME obręb/distance
 * for every lokal of one act). A comparable saved before `lokalId` existed
 * falls back to transactionId alone, first candidate found, but comes back
 * `matched: false`, so the document prints a dash rather than a guess about
 * which lokal of the act it was.
 *
 * A coop-register row (S5, defekt D-3) has `lokalId: ""` and `transactionId`
 * = `coopTxId`, so the transactionId-only join IS exact for it — that is what
 * `matched` recognises. Manual inclusions are searched too (final wave, I1):
 * a row the appraiser added that later fell out of BOTH `proposed` and
 * `alternates` exists only in `manualInclusions[].candidate`.
 */
export function candidateOf(
  comparable: Pick<Comparable, "transactionId" | "lokalId" | "coopTxId">,
  selection: KcsInput["sampleSelection"],
): { candidate: Candidate; matched: boolean } | null {
  const candidates = selection
    ? [
        ...selection.proposed,
        ...selection.alternates,
        ...(selection.manualInclusions ?? []).map((i) => i.candidate),
      ]
    : [];
  const { transactionId, lokalId, coopTxId } = comparable;
  if (!transactionId) return null;
  const candidate = lokalId
    ? candidates.find((c) => candidateKey(c) === candidateKey({ transactionId, lokalId }))
    : candidates.find((c) => c.transactionId === transactionId);
  if (!candidate) return null;
  const matched = Boolean(lokalId) || (Boolean(coopTxId) && candidate.transactionId === coopTxId);
  return { candidate, matched };
}

function lokalOfRow(comparable: Comparable, selection: KcsInput["sampleSelection"]): ExtremeLokal {
  const join = candidateOf(comparable, selection);
  return {
    key: comparable.transactionId
      ? candidateKey({ transactionId: comparable.transactionId, lokalId: comparable.lokalId ?? "" })
      : // ponytail: dwa wiersze ręczne o identycznej dacie|powierzchni|cenie dzielą
        // ocenę; trwały id wiersza, jeśli to kiedyś zaboli.
        `manual:${comparableContentKey(comparable)}`,
    comparable,
    candidate: join?.matched ? join.candidate : null,
    pricePerM2: comparable.pricePerM2,
  };
}

/** Wiersze o cenie najniższej i najwyższej — remis = wszystkie (D-53). */
export function extremeComparables(
  inputs: Pick<KcsInput, "comparables" | "sampleSelection">,
): Extremes {
  if (inputs.comparables.length === 0) return { min: [], max: [] };
  const rows = inputs.comparables.map((c) => lokalOfRow(c, inputs.sampleSelection));
  const prices = rows.map((r) => r.pricePerM2);
  const lowest = Math.min(...prices);
  const highest = Math.max(...prices);
  return {
    min: rows.filter((r) => r.pricePerM2 === lowest),
    max: rows.filter((r) => r.pricePerM2 === highest),
  };
}

/**
 * Lista do kroku 4 i bramki: Cmax najpierw (tak otwiera się §12.2 i karta),
 * potem Cmin; gdy cała próba ma jedną cenę, każdy lokal występuje raz.
 */
export function extremeLokale(
  inputs: Pick<KcsInput, "comparables" | "sampleSelection">,
): Array<ExtremeLokal & { side: ExtremeSide }> {
  const { min, max } = extremeComparables(inputs);
  const seen = new Set<string>();
  const out: Array<ExtremeLokal & { side: ExtremeSide }> = [];
  for (const [side, list] of [
    ["max", max],
    ["min", min],
  ] as const) {
    for (const lokal of list) {
      if (seen.has(lokal.key)) continue;
      seen.add(lokal.key);
      out.push({ ...lokal, side });
    }
  }
  return out;
}

/** Piętro (po konwersji kondygnacji RCN) albo metraż lokalu — to, co progi porównują. */
export function measuredValue(kind: FeatureMeasure["kind"], lokal: ExtremeLokal): number | null {
  return kind === "floor"
    ? pietroOfFloor(lokal.candidate?.floor, lokal.comparable.source)
    : (lokal.comparable.area ?? lokal.candidate?.area ?? null);
}

/** Poziom z progów cechy mierzalnej — dotychczasowa ścieżka §12.2 (D-52); null bez progów lub bez wartości. */
export function measuredLevel(
  feature: Pick<Feature, "measure">,
  lokal: ExtremeLokal,
): FeatureRating | null {
  const measure = feature.measure;
  if (!measure) return null;
  return levelForValue(measure, measuredValue(measure.kind, lokal));
}

export type RatingSuggestion =
  | { level: FeatureRating; source: "piętro" | "powierzchnia"; value: number; bound: MeasureBound }
  | { level: FeatureRating; source: "pomieszczenia przynależne"; annex: boolean };

const MEASURE_SOURCE: Record<FeatureMeasure["kind"], "piętro" | "powierzchnia"> = {
  floor: "piętro",
  area: "powierzchnia",
};

/**
 * Podpowiedź oceny lokalu skrajnego (ADR-022 reg. 3) — wyłącznie tam, gdzie
 * dane są: progi piętra/powierzchni, a dla „pomieszczenia przynależne”
 * kolumna P.P rejestru biura. Podpowiadany poziom musi być OPISANY (ADR-016
 * reg. 4) — inaczej nie ma kafelka, który „Przyjmij” mógłby zaznaczyć.
 * Nigdy nic nie zapisuje (ADR-016 reg. 5). Reguła P.P wisi na kluczu presetu;
 * przy trzeciej cesze z danymi przenieść ją na `FeatureMeasure.kind`.
 */
export function suggestedRating(
  feature: Pick<Feature, "key" | "definitions" | "measure">,
  lokal: ExtremeLokal,
): RatingSuggestion | null {
  const described = describedLevels(feature);
  const measure = feature.measure;
  if (measure) {
    const value = measuredValue(measure.kind, lokal);
    const level = levelForValue(measure, value);
    if (value == null || level == null || !described.includes(level)) return null;
    return { level, source: MEASURE_SOURCE[measure.kind], value, bound: measure.bounds[level]! };
  }
  if (feature.key === "pomieszczenia-przynalezne") {
    const annex = lokal.candidate?.annex;
    if (annex == null) return null;
    const level: FeatureRating = annex ? "lepsza" : "gorsza";
    return described.includes(level) ? { level, source: "pomieszczenia przynależne", annex } : null;
  }
  return null;
}

/**
 * Oceny przycięte do żywych lokali i żywych cech (`null` = brak filtra na tej
 * osi). Zmiana próby zostawia stare klucze — te znikają tu, nie w bazie;
 * usunięcie cechy z kroku 4 usuwa jej oceny przy zapisie. Puste → null.
 */
export function pruneComparableRatings(
  ratings: ComparableRatings | null | undefined,
  lokalKeys: Iterable<string> | null,
  featureKeys: Iterable<string> | null,
): ComparableRatings | null {
  if (!ratings) return null;
  const lokale = lokalKeys ? new Set(lokalKeys) : null;
  const cechy = featureKeys ? new Set(featureKeys) : null;
  const out: ComparableRatings = {};
  for (const [key, perFeature] of Object.entries(ratings)) {
    if (lokale && !lokale.has(key)) continue;
    const kept = Object.fromEntries(
      Object.entries(perFeature).filter(([featureKey]) => !cechy || cechy.has(featureKey)),
    );
    if (Object.keys(kept).length > 0) out[key] = kept;
  }
  return Object.keys(out).length > 0 ? out : null;
}
