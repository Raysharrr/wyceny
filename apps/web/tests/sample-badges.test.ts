import { describe, it, expect } from "vitest";
import {
  cooperativeLabel,
  cooperativesLabel,
  registryBadge,
  rowBadges,
} from "../src/app/valuations/[id]/steps/sample-badges";
import type { Candidate } from "../src/domain/sample-selection";

const c = (over: Partial<Candidate> = {}): Candidate => ({
  transactionId: "T1",
  date: "2026-05-10",
  area: 50,
  pricePerM2: 12000,
  priceTotal: 600000,
  egib: {
    teryt: "306401_1",
    obreb: "0039",
    arkusz: "22",
    dzialka: "13/82",
    budynek: "1",
    lokal: "7",
  },
  lokalId: "306401_1.0039.AR_22.13/82.1_BUD.7_LOK",
  distanceM: 0,
  floor: 3,
  rooms: 2,
  market: "wtorny",
  share: "1/1",
  transType: "wolnyRynek",
  function: "mieszkalna",
  seller: "osobaFizyczna",
  pos: { x: 1, y: 2 },
  ...over,
});
const subject = { obreb: "0039", arkusz: "22", dzialka: "13/82", budynek: "1" };

describe("rowBadges", () => {
  it("same building → one identity badge (secondary), no parcel/obręb duplicates", () => {
    const b = rowBadges(c(), [], subject);
    expect(b.map((x) => x.label)).toEqual(["ten sam budynek", "p. 3"]);
    expect(b[0].tone).toBe("secondary");
  });
  it("same parcel only → 'ta sama działka'; same obręb only → nothing (obręb column already says it)", () => {
    expect(
      rowBadges(c({ egib: { ...c().egib!, budynek: "2" } }), [], subject).map((x) => x.label),
    ).toContain("ta sama działka");
    expect(
      rowBadges(c({ egib: { ...c().egib!, dzialka: "99", budynek: "2" } }), [], subject).map(
        (x) => x.label,
      ),
    ).toEqual(["p. 3"]);
  });
  it("other obręb → 'inny obręb' (outline)", () => {
    const b = rowBadges(c({ egib: { ...c().egib!, obreb: "0040" } }), [], subject);
    expect(b.find((x) => x.label === "inny obręb")?.tone).toBe("outline");
  });
  it("flags → Polish labels; price_outlier & primary_suspect destructive, market_unknown outline", () => {
    const b = rowBadges(c(), ["price_outlier", "primary_suspect", "market_unknown"], subject);
    expect(b.map((x) => [x.label, x.tone])).toEqual(
      expect.arrayContaining([
        ["cena odstająca", "destructive"],
        ["prawdopodobnie deweloperska", "destructive"],
        ["rynek?", "outline"],
      ]),
    );
  });
  it("floor > 5 → '>5 kond.' in addition to 'p. N'; null floor → no floor badge", () => {
    expect(rowBadges(c({ floor: 7 }), [], subject).map((x) => x.label)).toEqual(
      expect.arrayContaining(["p. 7", ">5 kond."]),
    );
    expect(rowBadges(c({ floor: null }), [], subject).map((x) => x.label)).not.toContain(
      expect.stringMatching(/^p\. /),
    );
  });
  it("no subjectEgib → no identity badges at all", () => {
    expect(rowBadges(c(), [], undefined).map((x) => x.label)).toEqual(["p. 3"]);
  });
});

// S3: register badge and cooperative labels.
describe("rowBadges — źródło puli (S3)", () => {
  it("rejestr_sm → „Rejestr SM — do weryfikacji” jako pierwsza odznaka; rcn i brak źródła → bez odznaki", () => {
    expect(rowBadges(c(), [], undefined, "rejestr_sm").map((x) => x.label)).toEqual([
      "Rejestr SM — do weryfikacji",
      "p. 3",
    ]);
    expect(rowBadges(c(), [], undefined, "rcn").map((x) => x.label)).toEqual(["p. 3"]);
    expect(rowBadges(c(), [], undefined).map((x) => x.label)).toEqual(["p. 3"]);
  });
  it("registryBadge mówi jednym głosem z REGISTRY_LABEL", () => {
    expect(registryBadge("rcn").label).toBe("RCN — do weryfikacji");
    expect(registryBadge("rejestr_sm").label).toBe("Rejestr SM — do weryfikacji");
  });
  it("flagi S3: prawo nieznane / atrybuty nieznane", () => {
    expect(
      rowBadges(c(), ["attributes_unknown", "prawo_nieznane"], undefined).map((x) => x.label),
    ).toEqual(["p. 3", "atrybuty nieznane", "prawo nieznane"]);
  });
});

describe("cooperativeLabel / cooperativesLabel (S3)", () => {
  it("nie dubluje „SM”, zachowuje kolejność pierwszego wystąpienia, pusta lista dla puli RCN", () => {
    expect(cooperativeLabel("SM Osiedle Młodych")).toBe("SM „Osiedle Młodych”");
    expect(cooperativeLabel("Przylesie")).toBe("SM „Przylesie”");
    expect(
      cooperativesLabel([
        c({ cooperative: "SM B" }),
        c({ cooperative: "SM A" }),
        c({ cooperative: "SM B" }),
      ]),
    ).toBe("SM „B”, SM „A”");
    expect(cooperativesLabel([c(), c()])).toBe("");
  });
});
