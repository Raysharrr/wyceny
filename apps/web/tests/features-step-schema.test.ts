import { describe, expect, it } from "vitest";
import { featuresStepSchema } from "../src/app/actions/wizard-schemas";

/** Schemat kroku 4 niesie oceny lokali skrajnych (ADR-022) obok cech. */
const features = [
  {
    key: "standard-wykonczenia",
    name: "Standard wykończenia",
    weightPct: 50,
    rating: "lepsza",
    definitions: { lepsza: "a", przecietna: "b", gorsza: "c" },
  },
  {
    key: "lokalizacja",
    name: "Lokalizacja szczegółowa",
    weightPct: 50,
    rating: "przecietna",
    definitions: { lepsza: "d", przecietna: "e" },
  },
];

describe("featuresStepSchema — comparableRatings", () => {
  it("przyjmuje oceny per klucz lokalu i klucz cechy, także z kropkami w kluczu lokalu", () => {
    const parsed = featuresStepSchema.safeParse({
      features,
      comparableRatings: {
        "TX-1|306401_1.0039.x": { "standard-wykonczenia": "lepsza", lokalizacja: "przecietna" },
      },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.comparableRatings).toEqual({
      "TX-1|306401_1.0039.x": { "standard-wykonczenia": "lepsza", lokalizacja: "przecietna" },
    });
  });

  it("brak pola i null są dopuszczalne (szkice sprzed zmiany, wycofanie ocen)", () => {
    expect(featuresStepSchema.safeParse({ features }).success).toBe(true);
    expect(featuresStepSchema.safeParse({ features, comparableRatings: null }).success).toBe(true);
  });

  it("odrzuca poziom spoza skali", () => {
    const parsed = featuresStepSchema.safeParse({
      features,
      comparableRatings: { "TX-1|L": { "standard-wykonczenia": "najlepsza" } },
    });
    expect(parsed.success).toBe(false);
  });
});
