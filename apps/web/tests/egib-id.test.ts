import { describe, it, expect } from "vitest";
import { parseLokalId, deriveSubjectEgib, padObreb } from "../src/domain/egib-id";

describe("parseLokalId", () => {
  it("parses the Poznań format with AR_ and strips leading zeros from arkusz", () => {
    expect(parseLokalId("306401_1.0021.AR_04.27.2_BUD.11_LOK")).toEqual({
      teryt: "306401_1",
      obreb: "0021",
      arkusz: "4",
      dzialka: "27",
      budynek: "2",
      lokal: "11",
    });
  });
  it("parses the surrounding-gmina format without AR_ (arkusz = '')", () => {
    expect(parseLokalId("302104_2.0006.103/18.1_BUD.29_LOK")).toEqual({
      teryt: "302104_2",
      obreb: "0006",
      arkusz: "",
      dzialka: "103/18",
      budynek: "1",
      lokal: "29",
    });
  });
  it("pads obręb to 4 digits and returns null on garbage", () => {
    expect(parseLokalId("306401_1.21.AR_10.27.2_BUD.11_LOK")?.obreb).toBe("0021");
    expect(parseLokalId("")).toBeNull();
    expect(parseLokalId("306401_1.0021.AR_10.27")).toBeNull();
  });
  it("padObreb", () => {
    expect(padObreb("21")).toBe("0021");
    expect(padObreb("0021")).toBe("0021");
  });
});

describe("deriveSubjectEgib", () => {
  it("prefers the building id (obręb/arkusz/działka/budynek)", () => {
    expect(
      deriveSubjectEgib("306401_1.0039.AR_22.13/24.1_BUD", "306401_1.0039.AR_22.13/82"),
    ).toEqual({
      obreb: "0039",
      arkusz: "22",
      dzialka: "13/24",
      budynek: "1",
    });
  });
  it("falls back to the parcel id (no budynek)", () => {
    expect(deriveSubjectEgib(null, "306401_1.0021.AR_10.27")).toEqual({
      obreb: "0021",
      arkusz: "10",
      dzialka: "27",
    });
    expect(deriveSubjectEgib(null, "302104_2.0006.103/18")).toEqual({
      obreb: "0006",
      arkusz: "",
      dzialka: "103/18",
    });
  });
  it("returns undefined when neither parses", () => {
    expect(deriveSubjectEgib(undefined, undefined)).toBeUndefined();
    expect(deriveSubjectEgib("nope", "nope")).toBeUndefined();
  });
});
