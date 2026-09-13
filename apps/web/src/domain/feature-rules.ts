import { FEATURE_LEVELS, FEATURE_PRESETS } from "./feature-presets";
import type { CalculationIssue, Feature, FeatureRating } from "./valuation-input";

const TWO_LEVELS = ["lepsza", "gorsza"] as const;
export const FEATURE_WEIGHT_TOLERANCE = 0.001; // 0.1 percentage point, stored as a fraction.

/** Display order, highest first. Unknown scales have no allowed rating. */
export function allowedRatings(feature: Feature): readonly FeatureRating[] {
  if (feature.ratingScale === "two") return TWO_LEVELS;
  if (feature.ratingScale === undefined || feature.ratingScale === "three") return FEATURE_LEVELS;
  return [];
}

const normalizedName = (name: string): string => name.trim().replace(/\s+/g, " ").toLowerCase();

/** Arithmetic constraints shared by both new engines, independent of the catalog. */
export function featureCalculationIssues(features: readonly Feature[]): CalculationIssue[] {
  const issues: CalculationIssue[] = [];
  let sum = 0;
  features.forEach((feature, i) => {
    if (!Number.isFinite(feature.weight) || feature.weight < 0) {
      issues.push({ path: `features.${i}.weight`, label: "Waga musi być skończona i nieujemna." });
    }
    sum += feature.weight;
    if (!allowedRatings(feature).includes(feature.rating)) {
      issues.push({
        path: `features.${i}.rating`,
        label: "Wybierz ocenę dozwoloną w skali cechy.",
      });
    }
  });
  // Tiny floating point allowance preserves the inclusive ±0.1 p.p. boundary.
  if (!Number.isFinite(sum) || Math.abs(sum - 1) > FEATURE_WEIGHT_TOLERANCE + Number.EPSILON * 4) {
    issues.push({ path: "features", label: "Suma wag musi wynosić 100% (±0,1 p.p.)." });
  }
  return issues;
}

/** New-operation rules; do not apply retroactively when signing legacy KCS. */
export function validateFeatures(features: readonly Feature[]): CalculationIssue[] {
  const issues = featureCalculationIssues(features);
  const keys = new Set<string>();
  const names = new Set<string>();
  features.forEach((feature, i) => {
    const path = `features.${i}`;
    const name = normalizedName(feature.name);
    if (!name || feature.name.trim().length > 120) {
      issues.push({ path: `${path}.name`, label: "Nazwa cechy musi mieć od 1 do 120 znaków." });
    }
    if (names.has(name))
      issues.push({ path: `${path}.name`, label: "Nazwy cech muszą być unikalne." });
    names.add(name);
    const preset = FEATURE_PRESETS.lokal.find((entry) => entry.key === feature.key);
    if (feature.key !== undefined) {
      if (keys.has(feature.key))
        issues.push({ path: `${path}.key`, label: "Klucze cech muszą być unikalne." });
      keys.add(feature.key);
      if (!preset && feature.key !== "inne") {
        issues.push({
          path: `${path}.key`,
          label: "Nieznany klucz cechy. Wybierz cechę z katalogu lub własną.",
        });
      }
    }
    if (preset && feature.name !== preset.name) {
      issues.push({
        path: `${path}.name`,
        label: "Nazwa cechy katalogowej nie może być zmieniona.",
      });
    }
    if (
      feature.key === "inne" &&
      FEATURE_PRESETS.lokal.some((entry) => normalizedName(entry.name) === name)
    ) {
      issues.push({
        path: `${path}.name`,
        label: "Nazwa własnej cechy nie może powtarzać nazwy katalogowej.",
      });
    }
    for (const level of FEATURE_LEVELS) {
      const definition = feature.definitions?.[level];
      const required =
        (feature.key === "inne" || feature.ratingScale === "two") &&
        allowedRatings(feature).includes(level);
      if (required && !definition?.trim()) {
        issues.push({
          path: `${path}.definitions.${level}`,
          label: "Uzupełnij definicję poziomu skali.",
        });
      }
      if (definition !== undefined && definition.length > 1000) {
        issues.push({
          path: `${path}.definitions.${level}`,
          label: "Definicja może mieć do 1000 znaków.",
        });
      }
      if (feature.ratingScale === "two" && level === "przecietna" && definition !== undefined) {
        issues.push({
          path: `${path}.definitions.${level}`,
          label: "Skala dwupoziomowa zapisuje tylko definicje końców.",
        });
      }
    }
  });
  return issues;
}
