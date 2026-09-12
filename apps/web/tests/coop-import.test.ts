import { describe, expect, it } from "vitest";
import {
  COOP_FIELDS,
  missingRequiredFields,
  coopBuildingRef,
  coopDedupeKey,
  coopImportEventMeta,
  isSummaryRow,
  normalizeCoopAddress,
  parseCoopDate,
  parseCoopNumber,
  parseCoopSheet,
  parseFloor,
  parseRightType,
  splitAddressCell,
  type ColumnMapping,
} from "../src/domain/coop-import";
import fixture from "./fixtures/coop-registry-synthetic.sheets.json";

/**
 * Pure import rules (T-13, S2a Task 4) on the SYNTHETIC register fixture —
 * `coop-registry-synthetic.sheets.json` is the worker's `/coop-sheet` output
 * for `coop-registry-synthetic.xlsx` (both produced by the generator
 * `coop-registry-synthetic.mts`; the worker test pins the xlsx → json side).
 */

const SHEET_1 = fixture.sheets[0]!;
const SHEET_2 = fixture.sheets[1]!;
const MAPPING_1: ColumnMapping = {
  address: 1,
  buildingNumber: 2,
  flatNumber: 3,
  area: 4,
  priceTotal: 5,
  date: 6,
  rightType: 7,
  floor: 8,
  rooms: 9,
  buildYear: 10,
};
const CTX_1 = { cooperative: "SM Syntetyczna", priceKind: "nieustalona" as const, headerRow: 3 };

describe("isSummaryRow", () => {
  it.each([["suma"], ["SUMA"], [" Średnia "], ["min"], ["MAX:"], ["razem"]])(
    "recognises %j anywhere in the row",
    (word) => {
      expect(isSummaryRow(["", "x", word, "12"])).toBe(true);
    },
  );
  it("does not flag a transaction row", () => {
    expect(isSummaryRow(["1", "Zmyślona", "4", "12", "45.5", "455000"])).toBe(false);
    expect(isSummaryRow(["Minimalna 3"])).toBe(false);
  });
});

describe("normalizeCoopAddress", () => {
  it("glues the spelling variants of one estate", () => {
    const variants = [
      "Orła Białego ",
      "Orła Białego",
      "os. Orła Białego",
      "OS.Orła   Białego",
      "os Orła Białego",
    ];
    expect(new Set(variants.map(normalizeCoopAddress))).toEqual(new Set(["orła białego"]));
  });
  it("keeps diacritics and strips ul./al./pl. too", () => {
    expect(normalizeCoopAddress("ul. Świętego Wojciecha")).toBe("świętego wojciecha");
    expect(normalizeCoopAddress("al. Niepodległości")).toBe("niepodległości");
  });
  it("does not eat a name that merely starts with those letters", () => {
    expect(normalizeCoopAddress("Osiedlowa")).toBe("osiedlowa");
    expect(normalizeCoopAddress("Ulubiona")).toBe("ulubiona");
  });
});

describe("splitAddressCell", () => {
  it("splits 'Bukowa 12/5' into address, building and flat", () => {
    expect(splitAddressCell("ul. Bukowa 12/5")).toEqual({
      address: "ul. Bukowa",
      building: "12",
      flat: "5",
    });
    expect(splitAddressCell("Orła Białego 7a")).toEqual({
      address: "Orła Białego",
      building: "7a",
      flat: "",
    });
    expect(splitAddressCell("Piastowskie")).toBeNull();
  });
});

describe("parseCoopNumber / parseCoopDate", () => {
  it.each([
    ["450 000", 450000],
    ["43,34", 43.34],
    ["43.34", 43.34],
    ["1.234,56", 1234.56],
    ["520 000 zł", 520000],
    ["45,5 m²", 45.5],
    ["450.000", 450000],
    ["520.000 zł", 520000],
    ["1.234.567", 1234567],
    ["455000,00", 455000],
    ["1.234", null],
    ["45.500", null],
    ["abc", null],
    ["", null],
  ])("number %j → %j", (s, n) => expect(parseCoopNumber(s)).toBe(n));

  it.each([
    ["2025-01-14", "2025-01-14"],
    ["2025-01-14T00:00:00", "2025-01-14"],
    ["02.01.2023r.", "2023-01-02"],
    ["2.1.2023", "2023-01-02"],
    ["31.02.2023", null],
    ["wczoraj", null],
    ["14/01/2025", "2025-01-14"],
    ["2025/01/14", null],
    ["14.01.25", null],
  ])("date %j → %j — never guessed", (s, d) => expect(parseCoopDate(s)).toBe(d));
});

describe("parseRightType / parseFloor", () => {
  it("maps register wording, unknown → null (never a default)", () => {
    expect(parseRightType("spółdzielcze własnościowe")).toBe("spoldzielcze_wlasnosciowe");
    expect(parseRightType("Spoldzielcze wlasnosciowe prawo")).toBe("spoldzielcze_wlasnosciowe");
    expect(parseRightType("własność")).toBe("wlasnosc_lokalu");
    expect(parseRightType("odrębna własność")).toBe("wlasnosc_lokalu");
    expect(parseRightType("")).toBeNull();
    expect(parseRightType("X")).toBeNull();
  });
  it("reads floors in every spelling the registers use", () => {
    expect(parseFloor("parter")).toBe(0);
    expect(parseFloor("P")).toBe(0);
    expect(parseFloor("0")).toBe(0);
    expect(parseFloor("3")).toBe(3);
    expect(parseFloor("IV")).toBe(4);
    expect(parseFloor("I piętro")).toBe(1);
    expect(parseFloor("")).toBeNull();
    expect(parseFloor("wysoki")).toBeNull();
  });
});

describe("COOP_FIELDS", () => {
  it("requires the six fields of spec §6 — nr budynku and nr mieszkania included", () => {
    expect(COOP_FIELDS.filter((f) => f.required).map((f) => f.key)).toEqual([
      "address",
      "buildingNumber",
      "flatNumber",
      "area",
      "priceTotal",
      "date",
    ]);
  });
});

describe("coopDedupeKey", () => {
  const base = {
    address: "Piastowskie",
    buildingNumber: "97",
    flatNumber: "43",
    date: "2025-08-25",
    priceTotal: 450000,
    area: 43.34,
    rep: null,
  };
  it("two identical rows (incl. flat) → same key", () => {
    expect(coopDedupeKey(base)).toBe(coopDedupeKey({ ...base, address: "os. Piastowskie " }));
  });
  it("two flats, same building/day/price → different keys (NOT a duplicate)", () => {
    expect(coopDedupeKey(base)).not.toBe(coopDedupeKey({ ...base, flatNumber: "44" }));
  });
  it("rep. wins when present, but still per flat (one act can carry two flats)", () => {
    const a = coopDedupeKey({ ...base, rep: "A 1234/2025" });
    expect(a).toBe(coopDedupeKey({ ...base, rep: "a  1234/2025", priceTotal: 1 }));
    expect(a).not.toBe(coopDedupeKey({ ...base, rep: "A 1234/2025", flatNumber: "44" }));
  });
  const PRZYLESIE = { address: 0, area: 1, priceTotal: 2, date: 3, flatNumber: "absent" as const };
  const CTX = {
    cooperative: "SM Przylesie (syntetyczna)",
    priceKind: "transakcyjna" as const,
    headerRow: null,
  };

  it("register without a flat column (Przylesie): 45 m² and 52 m² same day/price stay two rows", () => {
    const rows = [
      ["os. Przylesie 12", "45", "450000", "2025-01-14"],
      ["os. Przylesie 12", "52", "450000", "2025-01-14"],
    ];
    const r = parseCoopSheet(rows, PRZYLESIE, CTX);
    expect(r.rows).toHaveLength(2);
    expect(r.skipped).toEqual([]);
    expect(r.warnings).toEqual([
      { row: 0, reason: "no_flat" },
      { row: 1, reason: "no_flat" },
    ]);
    // Building split off the address cell — the input of ADR-015 rule 6.
    expect(r.rows.map((x) => [x.address, x.buildingNumber, x.flatNumber])).toEqual([
      ["os. Przylesie", "12", ""],
      ["os. Przylesie", "12", ""],
    ]);
    expect(coopBuildingRef(r.rows[0]!)).toBe("przylesie|12");
    expect(r.rows[0]!.dedupeKey).toBe("przylesie 12|area:45|2025-01-14|450000");
  });

  it("two no-flat rows equal in building, day, price AND area merge — reported as no_flat_merge", () => {
    const rows = [
      ["os. Przylesie 12", "45", "450000", "2025-01-14"],
      ["os. Przylesie 12", "45", "450000", "2025-01-14"],
    ];
    const r = parseCoopSheet(rows, PRZYLESIE, CTX);
    expect(r.rows).toHaveLength(1);
    expect(r.skipped).toEqual([{ row: 1, reason: "duplicate" }]);
    expect(r.warnings).toEqual([
      { row: 0, reason: "no_flat" },
      { row: 1, reason: "no_flat_merge" },
    ]);
  });

  it("the key never depends on the row's position: an updated file with a row added above re-imports cleanly", () => {
    const v1 = [
      ["os. Przylesie 12", "45", "450000", "2025-01-14"],
      ["os. Przylesie 12", "52", "450000", "2025-01-14"],
    ];
    const v2 = [["os. Przylesie 30", "60", "500000", "2025-02-01"], ...v1];
    const keys1 = parseCoopSheet(v1, PRZYLESIE, CTX).rows.map((x) => x.dedupeKey);
    const keys2 = parseCoopSheet(v2, PRZYLESIE, CTX).rows.map((x) => x.dedupeKey);
    expect(keys2.slice(1)).toEqual(keys1);
    expect(parseCoopSheet(v1, PRZYLESIE, CTX).rows.map((x) => x.dedupeKey)).toEqual(keys1);
  });

  it("area above 10 000 m² is bad_number — a thousands dot read as area must not enter the register", () => {
    const r = parseCoopSheet(
      [["os. Przylesie 12", "56.000", "450000", "2025-01-14"]],
      PRZYLESIE,
      CTX,
    );
    expect(r.rows).toHaveLength(0);
    expect(r.skipped).toEqual([{ row: 0, reason: "bad_number" }]);
  });

  it("buildingRef = normalised address | building", () => {
    expect(coopBuildingRef({ address: "os. Piastowskie ", buildingNumber: "97" })).toBe(
      "piastowskie|97",
    );
  });
});

describe("parseCoopSheet on the synthetic fixture", () => {
  const result = parseCoopSheet(SHEET_1.rows, MAPPING_1, CTX_1);

  it("keeps the 5 real transactions and skips the rest with a reason each", () => {
    expect(result.rows).toHaveLength(5);
    expect(result.skipped).toEqual([
      { row: 5, reason: "duplicate" },
      { row: 8, reason: "summary" },
      { row: 10, reason: "empty" },
      { row: 11, reason: "bad_number" },
      { row: 12, reason: "bad_date" },
      { row: 14, reason: "summary" },
    ]);
  });

  it("a blank flat cell in a mapped column imports with a no_flat warning, keyed by area", () => {
    expect(result.warnings).toEqual([{ row: 13, reason: "no_flat" }]);
    expect(result.rows[4]!.dedupeKey).toBe("bukowa 9|area:50|2025-04-01|500000");
  });

  it("treats the same-day same-price flat 13 as a separate transaction", () => {
    expect(result.rows.map((r) => `${r.buildingNumber}/${r.flatNumber}`)).toEqual([
      "4/12",
      "4/13",
      "7/3",
      "7/5",
      "9/",
    ]);
  });

  it("parses decimal comma, spaced thousands and a text date", () => {
    const orla = result.rows[2]!;
    expect(orla).toMatchObject({
      address: "Orła Białego",
      area: 52.1,
      priceTotal: 520000,
      date: "2023-01-02",
      rightType: "wlasnosc_lokalu",
      floor: 0,
      rooms: 3,
      buildYear: 1980,
      source: "xls",
      pos: null,
    });
  });

  it("priceKind comes from the import context, rightType from the cell — null when blank", () => {
    expect(result.rows.every((r) => r.priceKind === "nieustalona")).toBe(true);
    expect(result.rows[3]!.rightType).toBeNull();
    expect(result.rows[3]!.floor).toBe(4);
  });

  it("no mapped right column → every rightType is null, never spoldzielcze", () => {
    const r = parseCoopSheet(SHEET_1.rows, { ...MAPPING_1, rightType: null }, CTX_1);
    expect(r.rows.map((x) => x.rightType)).toEqual([null, null, null, null, null]);
  });

  it("sheet without a header: data from row 0, flat split off the address cell, rep as key", () => {
    const r = parseCoopSheet(
      SHEET_2.rows,
      { rep: 0, date: 1, area: 2, priceTotal: 3, address: 4 },
      { cooperative: "SM Syntetyczna", priceKind: "transakcyjna", headerRow: null },
    );
    expect(r.skipped).toEqual([{ row: 1, reason: "duplicate" }]);
    expect(r.rows.map((x) => [x.address, x.buildingNumber, x.flatNumber, x.rep])).toEqual([
      ["ul. Bukowa", "12", "5", "A 1234/2025"],
      ["Bukowa", "14", "2", null],
    ]);
    expect(r.rows[0]!.dedupeKey.startsWith("rep:A 1234/2025|bukowa 12|5")).toBe(true);
    expect(coopBuildingRef(r.rows[0]!)).toBe("bukowa|12");
  });
});

describe("coopImportEventMeta (F-13)", () => {
  it("is numbers only — no address, flat, cooperative or file name", () => {
    const meta = coopImportEventMeta({
      rowsTotal: 15,
      inserted: 4,
      duplicates: 1,
      skipped: [
        { row: 5, reason: "duplicate" },
        { row: 8, reason: "summary" },
        { row: 11, reason: "bad_number" },
        { row: 12, reason: "bad_date" },
      ],
      warnings: [
        { row: 13, reason: "no_flat" },
        { row: 14, reason: "no_flat_merge" },
      ],
      geocoded: 3,
      needsFix: 1,
    });
    expect(meta).toEqual({
      rows_total: 15,
      inserted: 4,
      duplicates: 2,
      skipped_summary: 1,
      skipped_bad: 2,
      warned_no_flat: 1,
      warned_no_flat_merge: 1,
      geocoded: 3,
      needs_fix: 1,
    });
    expect(Object.values(meta).every((v) => typeof v === "number")).toBe(true);
  });
});

describe("missingRequiredFields (S2b wizard gate)", () => {
  it("lists unmapped required fields; 'absent' covers flatNumber, optional fields never count", () => {
    expect(missingRequiredFields({})).toEqual([
      "address",
      "buildingNumber",
      "flatNumber",
      "area",
      "priceTotal",
      "date",
    ]);
    expect(
      missingRequiredFields({
        address: 0,
        buildingNumber: 1,
        flatNumber: "absent",
        area: 2,
        priceTotal: 3,
        date: 4,
      }),
    ).toEqual([]);
    expect(
      missingRequiredFields({
        address: 0,
        buildingNumber: 1,
        flatNumber: null,
        area: 2,
        priceTotal: 3,
        date: 4,
      }),
    ).toEqual(["flatNumber"]);
  });
});

describe("one-cell address mapped to both address and building (S2b, Przylesie)", () => {
  it("splits 'os. Wymyślone 12' into address + building when both fields point at the same column", () => {
    const { rows } = parseCoopSheet(
      [["os. Wymyślone 12", "45", "450000", "2025-01-14"]],
      { address: 0, buildingNumber: 0, flatNumber: "absent", area: 1, priceTotal: 2, date: 3 },
      { cooperative: "SM", priceKind: "nieustalona", headerRow: null },
    );
    expect(rows[0]).toMatchObject({
      address: "os. Wymyślone",
      buildingNumber: "12",
      flatNumber: "",
    });
  });
});

describe("flat number mapped to the address column (review 1 m-9)", () => {
  it("takes the '/5' part, never the whole cell", () => {
    const { rows } = parseCoopSheet(
      [["Bukowa 12/5", "45", "450000", "2025-01-14"]],
      { address: 0, buildingNumber: 0, flatNumber: 0, area: 1, priceTotal: 2, date: 3 },
      { cooperative: "SM", priceKind: "nieustalona", headerRow: null },
    );
    expect(rows[0]).toMatchObject({ address: "Bukowa", buildingNumber: "12", flatNumber: "5" });
  });
});
