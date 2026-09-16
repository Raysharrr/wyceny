import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ksiegaTrescSchema, type KsiegaTresc } from "@/domain/kw-tresc";
import { aktZTresci, polaZTresci } from "@/domain/kw-z-tresci";

/**
 * The worker's own fixture — the synthetic book with fictional persons and
 * correct check digits — read IN PLACE, never copied. Copying its values into
 * this file would put KW-shaped strings into a tracked `.ts` and stop F-9
 * (`scripts/check-no-pii.sh`), which scans every tracked file regardless of
 * whether the numbers are real.
 */
const WORKER_FIXTURE = path.join(
  process.cwd(),
  "..",
  "worker",
  "tests",
  "fixtures",
  "kw_transcribe_sample.json",
);

function sample(): KsiegaTresc {
  const { walidacja, ...tresc } = JSON.parse(readFileSync(WORKER_FIXTURE, "utf8"));
  expect(walidacja).toBeDefined();
  return ksiegaTrescSchema.parse(tresc);
}

/** The same content with `podstawaNabycia` spelled a different, equally valid way. */
function withPodstawa(patch: Record<string, unknown>): KsiegaTresc {
  const tresc = sample();
  return {
    ...tresc,
    polaDodatkowe: {
      ...tresc.polaDodatkowe,
      podstawaNabycia: { ...tresc.polaDodatkowe.podstawaNabycia!, ...patch },
    },
  };
}

describe("polaZTresci — the transcription's polaDodatkowe as snapshot fields", () => {
  it("fills the four fields the card asks for, plus sąd/wydział from the header", () => {
    const tresc = sample();
    const pola = polaZTresci(tresc);
    expect(pola.nrLokalu).toBe(tresc.polaDodatkowe.numerLokalu);
    // Verbatim, spaces around "/" included — the share is eKW's text, not a
    // number we may tidy (spike RAPORT, "Proponowany schemat JSON").
    expect(pola.udzial).toBe(tresc.polaDodatkowe.udzial);
    expect(pola.kwGruntu).toBe(tresc.polaDodatkowe.kwGruntu);
    expect(pola.sad).toBe(tresc.naglowek.sad);
    expect(pola.wydzial).toBe(tresc.naglowek.wydzial);
  });

  it("returns nulls, not empty strings, when the book states none of them", () => {
    const tresc = sample();
    const blank: KsiegaTresc = {
      ...tresc,
      naglowek: { ...tresc.naglowek, sad: null, wydzial: null },
      polaDodatkowe: {
        numerLokalu: null,
        kwLokalu: null,
        kwGruntu: null,
        udzial: null,
        powierzchniaUzytkowa: null,
        podstawaNabycia: null,
      },
    };
    expect(polaZTresci(blank)).toEqual({
      nrLokalu: null,
      udzial: null,
      kwGruntu: null,
      sad: null,
      wydzial: null,
      akt: null,
    });
  });
});

describe("aktZTresci — dział II as the operat's three fields (ADR-018 reg. 1, D-12)", () => {
  it("takes the title, the Rep. A core and the date from podstawaNabycia", () => {
    const tresc = sample();
    const podstawa = tresc.polaDodatkowe.podstawaNabycia!;
    expect(aktZTresci(tresc)).toEqual({
      rodzaj: podstawa.tytulAktu,
      rep: podstawa.repA,
      data: podstawa.dataAktu,
    });
  });

  /**
   * Review #51's follow-up, moved to this session: the prompt does not pin the
   * spelling, so the model returns these fields with or without the eKW line's
   * prefixes. The operat prints `rodzaj` + "Rep. A nr " + `rep`, so an
   * unstripped value would read "AKT NOTARIALNY, UMOWA SPRZEDAŻY … Rep. A nr
   * REP. A NR 6497/2018". The worker's validator already compares the Rep. A
   * CORE (`\d+/\d+`, kw_validate.py) — this keeps web's reading of the same
   * value identical to the one that was validated.
   */
  it.each([
    ["REP. A NR 6497/2018", "6497/2018"],
    ["REP. A 6497/2018", "6497/2018"],
    ["Rep. A nr 6497/2018", "6497/2018"],
    ["A 6497/2018", "6497/2018"],
    ["6497/2018", "6497/2018"],
  ])("strips the Rep. A prefix: %s → %s", (raw, expected) => {
    expect(aktZTresci(withPodstawa({ repA: raw }))!.rep).toBe(expected);
  });

  it.each([
    ["AKT NOTARIALNY, UMOWA SPRZEDAŻY", "UMOWA SPRZEDAŻY"],
    ["AKT NOTARIALNY - UMOWA SPRZEDAŻY", "UMOWA SPRZEDAŻY"],
    ["UMOWA SPRZEDAŻY", "UMOWA SPRZEDAŻY"],
    ["UMOWA SPRZEDAŻY,", "UMOWA SPRZEDAŻY"],
  ])("strips the deed-kind prefix: %s → %s", (raw, expected) => {
    expect(aktZTresci(withPodstawa({ tytulAktu: raw }))!.rodzaj).toBe(expected);
  });

  it("keeps a title that IS just the deed kind — stripping it would empty the field", () => {
    expect(aktZTresci(withPodstawa({ tytulAktu: "AKT NOTARIALNY" }))!.rodzaj).toBe(
      "AKT NOTARIALNY",
    );
  });

  it("keeps a Rep. A that carries no number/year core, rather than dropping it", () => {
    expect(aktZTresci(withPodstawa({ repA: "BEZ NUMERU" }))!.rep).toBe("BEZ NUMERU");
  });

  it("is null when dział II names no document at all (D-12: then the operat says nothing)", () => {
    const tresc = sample();
    expect(
      aktZTresci({
        ...tresc,
        polaDodatkowe: { ...tresc.polaDodatkowe, podstawaNabycia: null },
      }),
    ).toBeNull();
  });

  it("is null when every part is blank, but survives when only one is there", () => {
    expect(aktZTresci(withPodstawa({ tytulAktu: null, repA: null, dataAktu: null }))).toBeNull();
    expect(aktZTresci(withPodstawa({ tytulAktu: null, repA: null }))).toEqual({
      rodzaj: "",
      rep: "",
      data: sample().polaDodatkowe.podstawaNabycia!.dataAktu,
    });
  });

  it("does not carry the notary — the operat's §7 sentence names the deed, not the office", () => {
    expect(Object.keys(aktZTresci(sample())!).sort()).toEqual(["data", "rep", "rodzaj"]);
  });
});
