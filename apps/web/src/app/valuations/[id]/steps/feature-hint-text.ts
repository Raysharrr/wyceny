import type { FeatureMeasure, MeasureBound } from "@/domain/kcs";

/**
 * Teksty liczb w podpowiedziach kroku 4 — wspólne dla podpowiedzi PRZEDMIOTU
 * (`step-features.tsx`) i podpowiedzi LOKALI o cenie skrajnej
 * (`step-features-extremes.tsx`, ADR-022), żeby ta sama wartość i ten sam próg
 * czytały się na obu kartach identycznie.
 */
export const measureValueFormatter = new Intl.NumberFormat("pl-PL", {
  maximumFractionDigits: 2,
});

/**
 * The suggested level's own band, split the way the mockup sets it: the
 * preposition stays in the running text, the numbers are the bold part. Both
 * edges are inclusive, so "do" means "up to and including" — the same word the
 * generated definition uses.
 */
export function boundText(
  kind: FeatureMeasure["kind"],
  bound: MeasureBound,
): { slowo: string; liczba: string } {
  const unit = (n: number) =>
    kind === "floor" ? String(n) : `${measureValueFormatter.format(n)} m²`;
  if (kind === "floor" && bound.od === 0 && bound.do === 0) return { slowo: "", liczba: "parter" };
  if (bound.od != null && bound.do != null) {
    return bound.od === 0
      ? { slowo: "do", liczba: unit(bound.do) }
      : { slowo: "od", liczba: `${unit(bound.od)} do ${unit(bound.do)}` };
  }
  if (bound.od != null) return { slowo: "od", liczba: unit(bound.od) };
  if (bound.do != null) return { slowo: "do", liczba: unit(bound.do) };
  return { slowo: "", liczba: "" };
}

export const MEASURE_NOUN: Record<FeatureMeasure["kind"], string> = {
  floor: "piętro",
  area: "powierzchnia",
};
