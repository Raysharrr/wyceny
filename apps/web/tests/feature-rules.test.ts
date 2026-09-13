import { describe, expect, it } from "vitest";
import { allowedRatings, validateFeatures } from "../src/domain/feature-rules";
import {
  FEATURE_INPUT_KEYS,
  FEATURE_PRESETS,
  LOKAL_FEATURE_KEYS,
} from "../src/domain/feature-presets";
import type { Feature } from "../src/domain/valuation-input";
const custom = (): Feature => ({
  key: "inne",
  name: "Nasłonecznienie",
  weight: 1,
  rating: "lepsza",
  definitions: { lepsza: "Jasne", przecietna: "Średnie", gorsza: "Ciemne" },
});

describe("shared feature rules (AC03/AC04)", () => {
  it("adds an input key without changing the nine-entry F6 catalog", () => {
    expect(LOKAL_FEATURE_KEYS).toHaveLength(9);
    expect(FEATURE_PRESETS.lokal).toHaveLength(9);
    expect(FEATURE_INPUT_KEYS).toEqual([...LOKAL_FEATURE_KEYS, "inne"]);
  });
  it("defaults historical absent scale to three and accepts keyless history", () => {
    expect(allowedRatings(custom())).toEqual(["lepsza", "przecietna", "gorsza"]);
    expect(validateFeatures([{ name: "Historyczna", rating: "przecietna", weight: 1 }])).toEqual(
      [],
    );
  });
  it("accepts complete custom features and rejects blank, long or reserved names", () => {
    expect(validateFeatures([custom()])).toEqual([]);
    for (const name of ["", " ", "x".repeat(121), " STANDARD   WYKOŃCZENIA "]) {
      expect(validateFeatures([{ ...custom(), name }])).toContainEqual(
        expect.objectContaining({ path: "features.0.name" }),
      );
    }
  });
  it("rejects duplicate keys/names and edited catalog names", () => {
    expect(
      validateFeatures([
        { ...custom(), weight: 0.5 },
        { ...custom(), weight: 0.5 },
      ]).length,
    ).toBeGreaterThan(0);
    expect(
      validateFeatures([
        { name: " Widok  na park ", weight: 0.5, rating: "lepsza" },
        { name: "widok na PARK", weight: 0.5, rating: "gorsza" },
      ]),
    ).toContainEqual(expect.objectContaining({ path: "features.1.name" }));
    expect(validateFeatures([{ ...custom(), key: "lokalizacja" }])).toContainEqual(
      expect.objectContaining({ path: "features.0.name" }),
    );
  });
  it("requires scale-two endpoints, rejects a hidden middle rating/definition", () => {
    const feature: Feature = {
      ...custom(),
      ratingScale: "two",
      definitions: { lepsza: "Jasne", gorsza: "Ciemne" },
    };
    expect(allowedRatings(feature)).toEqual(["lepsza", "gorsza"]);
    expect(validateFeatures([feature])).toEqual([]);
    expect(validateFeatures([{ ...feature, rating: "przecietna" }]).length).toBeGreaterThan(0);
    expect(
      validateFeatures([
        { ...feature, definitions: { ...feature.definitions, przecietna: "Ukryte" } },
      ]).length,
    ).toBeGreaterThan(0);
    expect(
      validateFeatures([{ ...feature, definitions: { lepsza: "Jasne" } }]).length,
    ).toBeGreaterThan(0);
  });
  it("requires complete custom definitions even at zero weight, caps all definitions", () => {
    const preset: Feature = {
      key: "lokalizacja",
      name: "lokalizacja",
      weight: 1,
      rating: "lepsza",
    };
    expect(validateFeatures([preset])).toEqual([]);
    expect(
      validateFeatures([preset, { ...custom(), weight: 0, definitions: {} }]).length,
    ).toBeGreaterThan(0);
    expect(
      validateFeatures([{ ...preset, definitions: { lepsza: "x".repeat(1001) } }]).length,
    ).toBeGreaterThan(0);
  });
  it.each([NaN, Infinity, -0.01, 0.998, 1.002])(
    "rejects invalid weights/sums %s without normalization",
    (weight) => {
      expect(validateFeatures([{ ...custom(), weight }]).length).toBeGreaterThan(0);
    },
  );
  it.each([0.999, 1, 1.001])("accepts sum tolerance boundary %s", (weight) => {
    const features = [{ ...custom(), weight }];
    expect(validateFeatures(features)).toEqual([]);
    expect(features[0].weight).toBe(weight);
  });
});
