import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDocumentModel,
  previewMarkerRow,
  type BuildDocumentInput,
} from "@/domain/document-model";
import { computeKcs, type KcsInput } from "@/domain/kcs";
import { ksiegaTrescSchema, type KsiegaTresc } from "@/domain/kw-tresc";
import type { EncumbranceTreatment, KwGruntSnapshot, KwSnapshot } from "@/domain/kw-snapshot";
import {
  goldenInputs,
  syntheticDocumentInput,
  AUTOR_TESTOWY,
} from "./fixtures/document-model-fixture";
import { wycena1409Anon } from "./fixtures/wycena-1409-anon";

/**
 * KR.2 — the operat's KW facts, at the MODEL level (the rendered §8.2 belongs
 * to `b1-template`). Every rule here has a source: ADR-018 reg. 4-6, the
 * operat diff's D-nn, and the invariants I-13/I-19.
 *
 * The transcription fixture is the worker's own synthetic book, read IN PLACE.
 * Its KW numbers have the real shape (with correct check digits), so copying
 * them into this tracked file would stop F-9 regardless of being invented.
 */
function transcribedBook(): KsiegaTresc {
  const wire = JSON.parse(
    readFileSync(
      path.join(process.cwd(), "..", "worker", "tests", "fixtures", "kw_transcribe_sample.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
  delete wire.walidacja;
  return ksiegaTrescSchema.parse(wire);
}

const EXAMINED_LOKAL: KwSnapshot = {
  source: "ekw_reczne",
  kwLokalu: "AB1C/1/9",
  kwGruntu: "AB1C/2/7",
  kwInne: [],
  deweloperski: false,
  powUzytkowaKw: 50.55,
  udzial: "3817 / 5294410",
  sad: "Sąd Rejonowy Poznań-Stare Miasto",
  wydzial: "V Wydział Ksiąg Wieczystych",
  dataDokumentu: null,
  dzial3: { wpisy: false, tresc: [] },
  dzial4: { wpisy: false, tresc: [] },
  // ISO in the snapshot, ALWAYS — the operat is the one place that formats it.
  dataBadania: "2026-09-15",
  nrLokalu: "24",
  akt: { rodzaj: "UMOWA SPRZEDAŻY", rep: "6497/2018", data: "2018-06-21" },
};

const EXAMINED_GRUNT: KwGruntSnapshot = {
  source: "ekw_reczne",
  nrKsiegi: "AB1C/2/7",
  dataBadania: "2026-09-12",
  dzial3: { wpisy: true, tresc: ["Służebność przesyłu na rzecz przedsiębiorstwa energetycznego"] },
  dzial4: { wpisy: false, tresc: [] },
};

function modelOf(
  patch: Partial<KcsInput>,
  right: BuildDocumentInput["propertyRight"] = "wlasnosc_lokalu",
) {
  const base = syntheticDocumentInput();
  const inputs: KcsInput = { ...goldenInputs(), ...patch };
  return buildDocumentModel({
    ...base,
    propertyRight: right,
    inputs,
    kcs: computeKcs(inputs),
    author: AUTOR_TESTOWY,
  });
}

describe("kw_badanie — true only for a book that was actually examined (ADR-018 reg. 3, I-13)", () => {
  it("is false when there is no snapshot at all", () => {
    const model = modelOf({ kw: null });
    expect(model.kw_badanie).toBe(false);
    expect(model.kw_standard).toBe(false);
    expect(model.kw_deweloperski).toBe(false);
  });

  /**
   * The 14.09 failure, as a model rule. A snapshot object EXISTS but nobody
   * answered the dzialy and nobody recorded a date, so nothing was examined —
   * and `kw != null`, the old predicate, called that an examination.
   */
  it("is false for a snapshot with no examination date and unanswered dzialy", () => {
    const model = modelOf({
      kw: { ...EXAMINED_LOKAL, dataBadania: null, dzial3: null, dzial4: null },
    });
    expect(model.kw_badanie).toBe(false);
  });

  it("is true once the lokal's book is examined, and picks the standard variant", () => {
    const model = modelOf({ kw: EXAMINED_LOKAL });
    expect(model.kw_badanie).toBe(true);
    expect(model.kw_standard).toBe(true);
    expect(model.kw_deweloperski).toBe(false);
  });

  /**
   * A lokal bought from a developer has no book of its own — the mother book
   * IS the examination. The old `kw != null` rule let the deed alone open the
   * block; the deed is not a register.
   */
  it("is true for a developer purchase once the GRUNT's book is examined, and false before", () => {
    const stub: KwSnapshot = { ...EXAMINED_LOKAL, kwLokalu: null, deweloperski: true };
    expect(modelOf({ kw: stub }).kw_badanie).toBe(false);
    const model = modelOf({ kw: stub, kwGrunt: EXAMINED_GRUNT });
    expect(model.kw_badanie).toBe(true);
    expect(model.kw_deweloperski).toBe(true);
    expect(model.kw_standard).toBe(false);
  });

  /** Exactly one of the pair whenever the block opens — never both, never neither. */
  it("keeps the standard/developer pair exclusive even with only the grunt examined", () => {
    const model = modelOf({ kw: null, kwGrunt: EXAMINED_GRUNT });
    expect(model.kw_badanie).toBe(true);
    expect([model.kw_standard, model.kw_deweloperski].filter(Boolean)).toHaveLength(1);
  });
});

describe("udzial_kw — no KW, no source (D-24, I-19, ADR-018 reg. 4)", () => {
  /**
   * The legacy fallback "wg odpisu księgi wieczystej" is gone. It named a
   * document nobody held, on exactly the valuations that had examined nothing
   * — the claim I-19 exists to forbid.
   */
  it("is an em dash when there is no snapshot", () => {
    expect(modelOf({ kw: null }).udzial_kw).toBe("—");
  });

  it("is the share from dział I-Sp when the book was examined (D-24)", () => {
    expect(modelOf({ kw: EXAMINED_LOKAL }).udzial_kw).toBe("3817 / 5294410");
  });

  it("is an em dash when the book was examined but states no share", () => {
    expect(modelOf({ kw: { ...EXAMINED_LOKAL, udzial: null } }).udzial_kw).toBe("—");
  });
});

describe("akt_opis — dział II's deed, or no sentence at all (ADR-018 reg. 5, D-12)", () => {
  it("is absent when no deed was recorded", () => {
    const model = modelOf({ kw: { ...EXAMINED_LOKAL, akt: null } });
    expect(model.ma_akt).toBe(false);
    expect(model.akt_opis).toBe("");
  });

  it("is absent when there is no snapshot at all (I-19)", () => {
    expect(modelOf({ kw: null }).ma_akt).toBe(false);
  });

  it("joins the kind, the Rep. A number and the date, with the date in PL format", () => {
    const model = modelOf({ kw: EXAMINED_LOKAL });
    expect(model.ma_akt).toBe(true);
    expect(model.akt_opis).toBe("UMOWA SPRZEDAŻY, Rep. A nr 6497/2018 z dnia 21.06.2018");
    // The ISO form must never reach paper.
    expect(model.akt_opis).not.toContain("2018-06-21");
  });

  it("drops the parts the book does not state rather than printing empty ones", () => {
    const model = modelOf({
      kw: { ...EXAMINED_LOKAL, akt: { rodzaj: "UMOWA SPRZEDAŻY", rep: "", data: "" } },
    });
    expect(model.akt_opis).toBe("UMOWA SPRZEDAŻY");
    const noKind = modelOf({
      kw: { ...EXAMINED_LOKAL, akt: { rodzaj: "", rep: "6497/2018", data: "" } },
    });
    expect(noKind.akt_opis).toBe("Rep. A nr 6497/2018");
  });
});

describe("protokół badania — one dated sentence per book (D-21)", () => {
  /**
   * The sentence the 14.09 operat should have carried instead of "Pełna treść
   * odpisu KW pozostaje w dokumentacji źródłowej rzeczoznawcy" (D-21).
   *
   * The date is the single most important detail here: `dataBadania` is stored
   * ISO and has never been rendered before, so this is the first place it can
   * reach paper — and it must not reach it as "2026-09-15".
   */
  it("dates the lokal's protocol in DD.MM.YYYY, never ISO", () => {
    const model = modelOf({ kw: EXAMINED_LOKAL });
    expect(model.ma_protokol_ksiegi_lokalu).toBe(true);
    // The whole sentence, not fragments: it is a CITATION from the office's own
    // operats (`operat-starolecka.txt:291`, and `polanka`/`kornik` agree), so
    // every character — the spaceless "r.", the bare domain, the closing colon
    // — is load-bearing and a paraphrase would pass a `toContain`.
    expect(model.protokol_ksiegi_lokalu).toBe(
      "W dniu 15.09.2026r. dokonano badania księgi wieczystej " +
        "nieruchomości lokalowej nr AB1C/1/9 (źródło: przegladarka-ekw.ms.gov.pl):",
    );
    expect(model.protokol_ksiegi_lokalu).not.toContain("2026-09-15");
  });

  it("dates the grunt's protocol from ITS OWN examination date, not the lokal's", () => {
    const model = modelOf({ kw: EXAMINED_LOKAL, kwGrunt: EXAMINED_GRUNT });
    expect(model.ma_protokol_ksiegi_gruntu).toBe(true);
    expect(model.protokol_ksiegi_gruntu).toContain("12.09.2026");
    expect(model.protokol_ksiegi_gruntu).not.toContain("15.09.2026");
  });

  it("says nothing about a book that was not examined", () => {
    const model = modelOf({ kw: null });
    expect(model.ma_protokol_ksiegi_lokalu).toBe(false);
    expect(model.protokol_ksiegi_lokalu).toBe("");
    expect(model.ma_protokol_ksiegi_gruntu).toBe(false);
  });

  it("says nothing when number and date are there but the dzialy are unanswered", () => {
    // The `zbadana` gate's own path, and the only one that reaches it: the deed
    // case below is stopped one step earlier, by `source`. Here the source is a
    // book and both facts are present, so number-and-date alone would print an
    // examination protocol for a book whose dzialy nobody read.
    const model = modelOf({ kw: { ...EXAMINED_LOKAL, dzial3: null, dzial4: null } });
    expect(model.kw_badanie).toBe(false);
    expect(model.protokol_ksiegi_lokalu).toBe("");
    expect(model.ma_protokol_ksiegi_lokalu).toBe(false);
  });

  it("says nothing about a grunt book whose dzialy are unanswered", () => {
    const model = modelOf({
      kw: EXAMINED_LOKAL,
      kwGrunt: { ...EXAMINED_GRUNT, dzial4: null },
    });
    expect(model.protokol_ksiegi_gruntu).toBe("");
    expect(model.ma_protokol_ksiegi_gruntu).toBe(false);
  });

  it("prints NO protocol for a deed, even though the deed carries a date (I-13)", () => {
    // An `akt` upload stamps `dataBadania` too, and the deed states the book's
    // number — so number-and-date alone printed "dokonano badania księgi
    // wieczystej" for a valuation whose book nobody opened (review PR #59).
    const model = modelOf({
      kw: { ...EXAMINED_LOKAL, source: "akt", dataBadania: "2026-09-15" },
    });
    expect(model.kw_badanie).toBe(false);
    expect(model.ma_protokol_ksiegi_lokalu).toBe(false);
    expect(model.protokol_ksiegi_lokalu).toBe("");
  });

  /**
   * THE ASSUMPTION, PINNED. The appraiser confirmed (15.09) that she obtains
   * odpisy from eKW, so an uploaded PDF is an eKW printout and both book paths
   * may name the same source. That is a fact about how the office works, not
   * about the data — the day paper odpisy from the court appear, whoever gives
   * one path its own wording fails HERE, instead of the operat quietly
   * attributing a document to a website nobody visited.
   */
  it("names the same source on both book paths — odpisy come from eKW too", () => {
    const zOdpisu = modelOf({ kw: { ...EXAMINED_LOKAL, source: "odpis_kw" } });
    const zRecznego = modelOf({ kw: EXAMINED_LOKAL });
    expect(zOdpisu.protokol_ksiegi_lokalu).toBe(zRecznego.protokol_ksiegi_lokalu);
    expect(zOdpisu.protokol_ksiegi_lokalu).toContain("(źródło: przegladarka-ekw.ms.gov.pl):");
    // `kw_zrodlo` still answers the other question — WHICH document was in hand
    // — so the two sentences differ without contradicting.
    expect(zOdpisu.kw_zrodlo).toContain("odpis");
    expect(zRecznego.kw_zrodlo).not.toContain("odpis");
  });
});

describe("§2 sentence about the grunt's book (D-07, check dryfu D-3)", () => {
  it("names the court and the number once the grunt's book is examined", () => {
    const model = modelOf({ kw: EXAMINED_LOKAL, kwGrunt: EXAMINED_GRUNT });
    expect(model.nr_ksiegi_gruntu).toBe("AB1C/2/7");
    // The lokal was carved out of the grunt, so the same court keeps both books
    // — the COURT, without its wydział. §2 names no wydział in any of the 16
    // reference operats; the Wyciąg always does. Joining both printed "Sąd
    // Rejonowy … V Wydział Ksiąg Wieczystych prowadzi księgę wieczystą nr …"
    // next to a neighbouring sentence naming the court alone (staging, 16.09).
    expect(model.sad_ksiegi_gruntu).toBe("Sąd Rejonowy Poznań-Stare Miasto");
    expect(model.sad_ksiegi_gruntu).not.toContain("Wydział");
    // The Wyciąg keeps both, as its own row.
    expect(model.kw_sad).toBe("Sąd Rejonowy Poznań-Stare Miasto");
    expect(model.kw_wydzial).toBe("V Wydział Ksiąg Wieczystych");
  });

  it("is empty when the grunt's book was not examined — the generic sentence is forbidden (D-07)", () => {
    const model = modelOf({ kw: EXAMINED_LOKAL });
    expect(model.nr_ksiegi_gruntu).toBe("");
    expect(model.sad_ksiegi_gruntu).toBe("");
  });

  it("gates the sentence on ma_ksiege_gruntu, which kw_badanie cannot do", () => {
    // An examined lokal ALONE makes `kw_badanie` true. Were §2's grunt sentence
    // wrapped in it — as check dryfu D-3 proposed — it would print with no
    // number and no court. `ma_ksiege_gruntu` is the flag that separates them,
    // and it exists so the template never has to lean on "" not printing.
    const samLokal = modelOf({ kw: EXAMINED_LOKAL });
    expect(samLokal.kw_badanie).toBe(true);
    expect(samLokal.ma_ksiege_gruntu).toBe(false);

    const obie = modelOf({ kw: EXAMINED_LOKAL, kwGrunt: EXAMINED_GRUNT });
    expect(obie.ma_ksiege_gruntu).toBe(true);
    expect(obie.nr_ksiegi_gruntu).toBe("AB1C/2/7");
  });

  it("leaves every court field empty — never a dash — when the snapshot states none", () => {
    // The manual eKW path with the court left blank. A dash here is not a
    // display detail: `{#kw_sad}` reads any non-empty value as a court, so "—"
    // would print "Dla nieruchomości lokalowej … — prowadzi księgę wieczystą
    // nr …" in §2 and a lone dash in the Wyciąg. Empty picks the sentence that
    // needs no court ("prowadzona jest księga wieczysta nr …").
    const model = modelOf({
      kw: { ...EXAMINED_LOKAL, sad: null, wydzial: null },
      kwGrunt: EXAMINED_GRUNT,
    });
    expect(model.nr_ksiegi_gruntu).toBe("AB1C/2/7");
    expect(model.sad_ksiegi_gruntu).toBe("");
    expect(model.kw_sad).toBe("");
    expect(model.kw_wydzial).toBe("");
  });

  it("gates the document's date: an akt has one, the manual eKW path has none", () => {
    // §8.2 wrote "(data dokumentu: —)" on the everyday manual path — a hole no
    // operat has. The date exists for an akt or an odpis; reading the book in
    // eKW produces no document to date.
    const zAktem = modelOf({ kw: { ...EXAMINED_LOKAL, dataDokumentu: "2026-09-01" } });
    expect(zAktem.ma_kw_data_dok).toBe(true);
    expect(zAktem.kw_data_dok).toBe("01.09.2026");
    const reczne = modelOf({ kw: { ...EXAMINED_LOKAL, dataDokumentu: null } });
    expect(reczne.ma_kw_data_dok).toBe(false);
    expect(reczne.kw_data_dok).toBe("");
  });

  it("carries the court the appraiser typed to the Wyciąg and §2", () => {
    // Until 16.09 both places printed one court baked into the template as a
    // literal, so a flat in Kórnik was filed with the Poznań Stare Miasto court.
    const model = modelOf({
      kw: {
        ...EXAMINED_LOKAL,
        sad: "Sąd Rejonowy w Środzie Wielkopolskiej",
        wydzial: "V Wydział Ksiąg Wieczystych",
      },
      kwGrunt: EXAMINED_GRUNT,
    });
    expect(model.kw_sad).toBe("Sąd Rejonowy w Środzie Wielkopolskiej");
    expect(model.kw_wydzial).toBe("V Wydział Ksiąg Wieczystych");
  });
});

describe("ksiega_lokalu_wiersze — the five dzialy flattened for §8.2", () => {
  it("is empty and flagged absent when no transcription was stored", () => {
    const model = modelOf({ kw: EXAMINED_LOKAL });
    expect(model.ma_tresc_lokalu).toBe(false);
    expect(model.ksiega_lokalu_wiersze).toEqual([]);
  });

  it("opens each dział in eKW order and keeps the table/entry/rubric nesting", () => {
    const tresc = transcribedBook();
    const model = modelOf({ kw: { ...EXAMINED_LOKAL, tresc } });
    expect(model.ma_tresc_lokalu).toBe(true);
    const rows = model.ksiega_lokalu_wiersze;
    expect(rows.filter((r) => r.typ === "dzial").map((r) => r.kol1)).toEqual(
      tresc.dzialy.map((d) => d.tytul),
    );
    // Order, not just presence: a dział's own rows follow its heading and
    // precede the next one.
    const firstDzial = rows.findIndex((r) => r.typ === "dzial");
    expect(rows[firstDzial + 1]).toEqual({
      typ: "tabela",
      kol1: tresc.dzialy[0].tabele[0].naglowek,
      kol2: "",
      kol3: "",
    });
  });

  /**
   * Written first as `join(" | ")` on both sides, this passed with the
   * separator changed to ", " — the expectation was computed the same way as
   * the code, so it moved with it. The separator is named LITERALLY here, and
   * the cells it separates are asserted to contain commas of their own, which
   * is precisely why a comma cannot be the separator.
   */
  it("joins a rubric's cells with a pipe — the cells' own commas rule a comma out", () => {
    const tresc = transcribedBook();
    const model = modelOf({ kw: { ...EXAMINED_LOKAL, tresc } });
    const rubryki = tresc.dzialy.flatMap((d) =>
      d.tabele.flatMap((t) => t.wpisy.flatMap((w) => w.rubryki)),
    );
    // A MULTI-CELL rubric — the only shape that can tell two separators apart.
    // A single-cell rubric renders identically whatever the separator is, which
    // is exactly why the first version of this test survived the mutation.
    const rubryka = rubryki.find((r) => r.wartosci.length > 1)!;
    expect(rubryka).toBeDefined();
    const row = model.ksiega_lokalu_wiersze.find(
      (r) => r.typ === "rubryka" && r.kol1 === rubryka.nazwa,
    );
    expect(row).toBeDefined();
    expect(row!.kol3).toContain(" | ");
    // Each cell arrives whole, and the pipe count matches the gaps between them.
    for (const cell of rubryka.wartosci) expect(row!.kol3).toContain(cell);
    expect(row!.kol3.split(" | ")).toHaveLength(rubryka.wartosci.length);
    expect(row!.kol2).toBe(rubryka.lp ?? "");
    // And the reason a comma is not an option: the book's own cells are full of
    // them, so a comma separator would blur the boundary BETWEEN cells into the
    // punctuation INSIDE one. (In this book the comma-bearing cells happen to be
    // single-cell rubrics, so the two facts are asserted separately.)
    expect(rubryki.flatMap((r) => r.wartosci).filter((v) => v.includes(","))).not.toHaveLength(0);
  });

  it("emits a BRAK WPISÓW row for an empty dział instead of nothing", () => {
    const tresc = transcribedBook();
    const empty: KsiegaTresc = {
      ...tresc,
      dzialy: tresc.dzialy.map((d) =>
        d.kod === "IV" ? { ...d, brakWpisow: true, tabele: [], dokumenty: [] } : d,
      ),
    };
    const rows = modelOf({ kw: { ...EXAMINED_LOKAL, tresc: empty } }).ksiega_lokalu_wiersze;
    const idx = rows.findIndex((r) => r.typ === "dzial" && r.kol1.includes("DZIAŁ IV"));
    expect(rows[idx + 1]).toEqual({ typ: "brak", kol1: "BRAK WPISÓW", kol2: "", kol3: "" });
  });

  /**
   * Kolumna środkowa (600 dxa) jest kolumną PORZĄDKOWĄ — mieści liczbę, nie
   * tekst. Nr podstawy wpisu jest liczbą, więc wiersz `lp` trzyma go tam, a nie
   * w szerokiej `kol3` (ujednolicenie z wierszem `dokument`, uwaga recenzenta
   * 22.09).
   */
  it("puts the entry's Lp. and its nr podstawy wpisu on one row", () => {
    const tresc = transcribedBook();
    const rows = modelOf({ kw: { ...EXAMINED_LOKAL, tresc } }).ksiega_lokalu_wiersze;
    const wpis = tresc.dzialy[1].tabele[0].wpisy[0];
    expect(rows).toContainEqual({
      typ: "lp",
      kol1: `Lp. ${wpis.lp}.`,
      kol2: wpis.nrPodstawyWpisu,
      kol3: "",
    });
  });

  /**
   * Zgłoszenie koordynatora po zrzucie §8.2 (22.09): opis dokumentu jechał w
   * `kol2`, a ta kolumna ma w szablonie 600 dxa — Word łamał w niej długie
   * nazwy po trzy, cztery znaki na wiersz („WYP / IS Z / REJ…”). Wiersz
   * dokumentu rozkłada się więc na trzy kolumny wedle ich szerokości: nazwa
   * dokumentu w `kol1` (3400 dxa, tam gdzie etykiety rubryk), nr podstawy
   * wpisu w porządkowej `kol2`, wniosek DZ. KW. w najszerszej `kol3`. Dokument
   * i wniosek zostają osobno — to dwa różne fakty księgi.
   */
  it("carries the documents section of each dział, split by column width", () => {
    const tresc = transcribedBook();
    const rows = modelOf({ kw: { ...EXAMINED_LOKAL, tresc } }).ksiega_lokalu_wiersze;
    const doc = tresc.dzialy[2].dokumenty[0];
    const row = rows.find((r) => r.typ === "dokument" && r.kol2 === doc.nrPodstawyWpisu);
    expect(row).toBeDefined();
    expect(row!.kol1).toContain(doc.dokument);
    if (doc.dokumentOpisPol) expect(row!.kol1).toContain(doc.dokumentOpisPol);
    if (doc.wniosek) expect(row!.kol3).toContain(doc.wniosek);
    if (doc.wniosekOpisPol) expect(row!.kol3).toContain(doc.wniosekOpisPol);
    // Dokument NIE jest sklejony z wnioskiem.
    expect(row!.kol3).not.toContain(doc.dokument);
  });

  it("kolumna porządkowa niesie tylko numer, nigdy tekst — w obu księgach", () => {
    const model = modelOf({
      kw: { ...EXAMINED_LOKAL, tresc: transcribedBook() },
      kwGrunt: { ...EXAMINED_GRUNT, tresc: transcribedBook() },
    });
    const wiersze = [...model.ksiega_lokalu_wiersze, ...model.ksiega_gruntu_wiersze].filter(
      (r) => r.typ === "dokument" || r.typ === "lp",
    );
    expect(wiersze.length).toBeGreaterThan(0);
    // 600 dxa mieści liczbę porządkową i nic więcej; wszystko dłuższe łamało się
    // w Wordzie po trzy znaki na wiersz.
    expect(wiersze.filter((r) => !/^\d*$/.test(r.kol2))).toEqual([]);
    // Bez znaku nowej linii nigdzie: render ma `linebreaks: true`, więc `\n`
    // stałoby się `<w:br/>` — dokładnie defekt klasy D-30 w akapicie justowanym.
    expect(wiersze.filter((r) => `${r.kol1}${r.kol3}`.includes("\n"))).toEqual([]);
  });

  /**
   * ADR-018 reg. 7 (decyzja usera 15.09) DELIBERATELY overrides the F-12
   * minimisation for this one field: §8.2 prints the dzialy as Aneta does,
   * persons and PESELs included, because the office's operat does. The rule is
   * pinned here so that a future tightening of F-12 has to face the decision
   * rather than quietly re-scrub the book.
   */
  it("carries persons' data from the transcription on purpose (ADR-018 reg. 7)", () => {
    const tresc = transcribedBook();
    const rows = modelOf({ kw: { ...EXAMINED_LOKAL, tresc } }).ksiega_lokalu_wiersze;
    const owners = tresc.dzialy
      .find((d) => d.kod === "II")!
      .tabele.flatMap((t) => t.wpisy.flatMap((w) => w.rubryki.flatMap((r) => r.wartosci)));
    const pesel = owners.find((v) => /\b\d{11}\b/.test(v));
    expect(pesel).toBeDefined();
    expect(JSON.stringify(rows)).toContain(pesel);
  });
});

describe("dzial3_opis / dzial4_opis — the manual path's sentences", () => {
  it("describes the entries the appraiser typed", () => {
    const model = modelOf({
      kw: {
        ...EXAMINED_LOKAL,
        dzial3: { wpisy: true, tresc: ["Służebność osobista mieszkania"] },
      },
    });
    expect(model.dzial3_opis).toContain("Służebność osobista mieszkania");
    expect(model.dzial4_opis).toContain("brak wpisów");
  });

  it("says nothing about a dział nobody answered — silence, not 'brak wpisów'", () => {
    const model = modelOf({ kw: { ...EXAMINED_LOKAL, dzial3: null, dzial4: null } });
    expect(model.dzial3_opis).toBe("");
    expect(model.dzial4_opis).toBe("");
  });
});

describe("obciążenie — three states, not two (ADR-018 reg. 6, D-02, D-25, D-35)", () => {
  const withEntry = (treatment: EncumbranceTreatment | null): KcsInput["encumbranceTreatment"] =>
    treatment;
  const kwWithEntry: KwSnapshot = {
    ...EXAMINED_LOKAL,
    dzial3: { wpisy: true, tresc: ["Służebność osobista mieszkania"] },
  };

  it("is absent when the lokal's dział III has no entry", () => {
    const model = modelOf({ kw: EXAMINED_LOKAL });
    expect(model.ma_obciazenie).toBe(false);
    expect(model.obciazenie_bez_uwzglednienia).toBe(false);
    expect(model.obciazenie_z_uwzglednieniem).toBe(false);
    expect(model.obciazenie_podstawa).toBe("");
  });

  it("names the 'bez uwzględnienia' variant and its basis (D-02, D-35)", () => {
    const model = modelOf({
      kw: kwWithEntry,
      encumbranceTreatment: withEntry({
        wariant: "bez_uwzglednienia",
        podstawa: "Zgodnie z poleceniem Zleceniodawcy.",
      }),
    });
    expect(model.ma_obciazenie).toBe(true);
    expect(model.obciazenie_bez_uwzglednienia).toBe(true);
    expect(model.obciazenie_z_uwzglednieniem).toBe(false);
    expect(model.obciazenie_podstawa).toBe("Zgodnie z poleceniem Zleceniodawcy.");
  });

  it("names the 'z uwzględnieniem' variant", () => {
    const model = modelOf({
      kw: kwWithEntry,
      encumbranceTreatment: withEntry({
        wariant: "z_uwzglednieniem",
        podstawa: "Oświadczenie właściciela.",
      }),
    });
    expect(model.obciazenie_z_uwzglednieniem).toBe(true);
    expect(model.obciazenie_bez_uwzglednienia).toBe(false);
  });

  /**
   * The THIRD state, reachable since PR #55 made `wariant` nullable: the basis
   * is typed, the variant is not chosen yet. The model must not pick one for
   * the appraiser — the entry is described, and neither phrase is claimed.
   * Only the preview reaches this; B-07 refuses to approve it.
   */
  it("describes the entry but claims neither variant when none has been chosen", () => {
    const model = modelOf({
      kw: kwWithEntry,
      encumbranceTreatment: withEntry({
        wariant: null,
        podstawa: "Do ustalenia ze Zleceniodawcą.",
      }),
    });
    expect(model.ma_obciazenie).toBe(true);
    expect(model.obciazenie_bez_uwzglednienia).toBe(false);
    expect(model.obciazenie_z_uwzglednieniem).toBe(false);
    expect(model.obciazenie_podstawa).toBe("Do ustalenia ze Zleceniodawcą.");
  });

  /** Dział III of the GRUNT's book is described, but does not encumber this lokal (D-02). */
  it("is not raised by an entry in the grunt's dział III", () => {
    const model = modelOf({ kw: EXAMINED_LOKAL, kwGrunt: EXAMINED_GRUNT });
    expect(model.ma_obciazenie).toBe(false);
  });
});

describe("I-19 — with no KW, nothing in the model points at one", () => {
  it("leaves every KW-sourced field empty or dashed", () => {
    const model = modelOf({ kw: null, kwGrunt: null });
    expect(model.kw_badanie).toBe(false);
    expect(model.udzial_kw).toBe("—");
    expect(model.kw_lokalu).toBe("—");
    expect(model.kw_gruntu).toBe("—");
    expect(model.ma_akt).toBe(false);
    expect(model.ma_tresc_lokalu).toBe(false);
    expect(model.ma_protokol_ksiegi_lokalu).toBe(false);
    expect(model.ma_protokol_ksiegi_gruntu).toBe(false);
    expect(model.nr_ksiegi_gruntu).toBe("");
    expect(model.ma_obciazenie).toBe(false);
  });

  /**
   * `b1-template` steers the §8.2 block by `ma_protokol_*`, so the day those
   * flags and `kw_badanie` disagree the operat prints an examination protocol
   * inside a document that says no book was examined (review PR #59). They
   * cannot disagree — both read `kwRequirements` — and this pins it across the
   * matrix rather than leaving it a property of one reading of the code.
   */
  it("never lets a protocol flag outrun kw_badanie (I-13)", () => {
    const snapshots: Array<Partial<KcsInput>> = [
      { kw: null, kwGrunt: null },
      { kw: EXAMINED_LOKAL },
      { kw: EXAMINED_LOKAL, kwGrunt: EXAMINED_GRUNT },
      { kw: null, kwGrunt: EXAMINED_GRUNT },
      { kw: { ...EXAMINED_LOKAL, source: "akt" } },
      { kw: { ...EXAMINED_LOKAL, dzial3: null, dzial4: null } },
      { kw: { ...EXAMINED_LOKAL, dataBadania: null } },
      { kw: { ...EXAMINED_LOKAL, kwLokalu: null, deweloperski: true }, kwGrunt: EXAMINED_GRUNT },
    ];
    for (const patch of snapshots) {
      const m = modelOf(patch);
      if (m.ma_protokol_ksiegi_lokalu || m.ma_protokol_ksiegi_gruntu) {
        expect(m.kw_badanie).toBe(true);
      }
      // And the flag agrees with its own sentence, in both directions.
      expect(m.ma_protokol_ksiegi_lokalu).toBe(m.protokol_ksiegi_lokalu !== "");
      expect(m.ma_protokol_ksiegi_gruntu).toBe(m.protokol_ksiegi_gruntu !== "");
    }
  });
});

/**
 * The same rules, on the anonymised 14.09 valuation — the shape the whole
 * paczka is measured against. Kept apart from the focused cases above because
 * this is the end-to-end one: a real KcsInput, a real KCS run, both books.
 */
describe("wycena 14.09 (zanonimizowana) — warianty badania ksiąg", () => {
  it("wariant `brak`: żadne pole nie wskazuje KW jako źródła (I-19)", () => {
    const model = buildDocumentModel(wycena1409Anon({ kw: "brak" }));
    expect(model.kw_badanie).toBe(false);
    expect(model.udzial_kw).toBe("—");
    expect(model.ma_akt).toBe(false);
    expect(model.ma_tresc_lokalu).toBe(false);
    expect(model.ma_obciazenie).toBe(false);
  });

  it("wariant `ekw_reczne_obie_ksiegi`: protokoły obu ksiąg i zdania działów, bez tabeli", () => {
    const model = buildDocumentModel(wycena1409Anon({ kw: "ekw_reczne_obie_ksiegi" }));
    expect(model.kw_badanie).toBe(true);
    expect(model.ma_protokol_ksiegi_lokalu).toBe(true);
    expect(model.ma_protokol_ksiegi_gruntu).toBe(true);
    expect(model.protokol_ksiegi_lokalu).toContain("14.09.2026");
    expect(model.ma_tresc_lokalu).toBe(false);
    expect(model.dzial3_opis).toContain("Służebność osobista mieszkania");
    expect(model.ma_akt).toBe(true);
    // Wpis w dziale III lokalu → wariant „bez" z podstawą (D-02, D-35).
    expect(model.ma_obciazenie).toBe(true);
    expect(model.obciazenie_bez_uwzglednienia).toBe(true);
    expect(model.obciazenie_podstawa).not.toBe("");
  });

  it("wariant `pdf_lokalu_z_trescia`: te same fakty plus tabela pięciu działów", () => {
    const model = buildDocumentModel(wycena1409Anon({ kw: "pdf_lokalu_z_trescia" }));
    expect(model.ma_tresc_lokalu).toBe(true);
    expect(model.ksiega_lokalu_wiersze.filter((r) => r.typ === "dzial")).toHaveLength(5);
    // Zdania ścieżki ręcznej zostają w modelu — który wariant drukuje §8.2,
    // rozstrzyga `ma_tresc_lokalu` w szablonie (b1-template), nie model.
    expect(model.dzial3_opis).not.toBe("");
  });
});

describe("§8.2 księgi gruntu z treścią (ADR-021 reg. 6)", () => {
  const GRUNT_Z_TRESCIA: KwGruntSnapshot = {
    ...EXAMINED_GRUNT,
    source: "ekw_wklej",
    sad: "Sąd Rejonowy w Testowie",
    wydzial: "I Wydział Ksiąg Wieczystych",
    tresc: transcribedBook(),
    transkrypcja: {
      ok: true,
      bledy: [],
      kanal: "tekst",
      plikow: 0,
      at: "2026-09-21T10:00:00.000Z",
    },
  };

  it("ma_tresc_gruntu i wiersze z TEGO SAMEGO ksiegaRows co lokal — pięć działów w kolejności eKW", () => {
    const model = modelOf({
      kw: { ...EXAMINED_LOKAL, tresc: transcribedBook() },
      kwGrunt: GRUNT_Z_TRESCIA,
    });
    expect(model.ma_tresc_gruntu).toBe(true);
    expect(model.ksiega_gruntu_wiersze).toEqual(model.ksiega_lokalu_wiersze);
    expect(model.ksiega_gruntu_wiersze.filter((r) => r.typ === "dzial").map((r) => r.kol1)).toEqual(
      transcribedBook().dzialy.map((d) => d.tytul),
    );
  });

  it("bez treści gruntu: flaga false, zero wierszy, zdania ścieżki bez treści zostają", () => {
    const model = modelOf({ kw: EXAMINED_LOKAL, kwGrunt: EXAMINED_GRUNT });
    expect(model.ma_tresc_gruntu).toBe(false);
    expect(model.ksiega_gruntu_wiersze).toEqual([]);
    expect(model.dzial3_opis_gruntu).toContain("Służebność przesyłu");
  });

  it("ma_tresc_lokalu = tresc != null, niezależnie od werdyktu (reg. 5)", () => {
    const zlyWerdykt = {
      ok: false,
      bledy: [{ klasa: "pesel_suma", dzial: "II" }],
      kanal: "pdf" as const,
      plikow: 1,
      at: "2026-09-21T10:00:00.000Z",
    };
    const model = modelOf({
      kw: { ...EXAMINED_LOKAL, tresc: transcribedBook(), transkrypcja: zlyWerdykt },
    });
    expect(model.ma_tresc_lokalu).toBe(true);
    expect(model.ksiega_lokalu_wiersze.length).toBeGreaterThan(5);
  });

  it("sąd księgi gruntu w §2 z jej własnej migawki, a dopiero potem z księgi lokalu", () => {
    const model = modelOf({ kw: EXAMINED_LOKAL, kwGrunt: GRUNT_Z_TRESCIA });
    expect(model.sad_ksiegi_gruntu).toBe("Sąd Rejonowy w Testowie");
    expect(modelOf({ kw: EXAMINED_LOKAL, kwGrunt: EXAMINED_GRUNT }).sad_ksiegi_gruntu).toBe(
      EXAMINED_LOKAL.sad,
    );
  });

  it("kw_zrodlo dla ekw_wklej nazywa badanie w eKW, nie odpis", () => {
    expect(modelOf({ kw: { ...EXAMINED_LOKAL, source: "ekw_wklej" } }).kw_zrodlo).toBe(
      "badanie księgi wieczystej w systemie eKW",
    );
  });
});

describe("werdykt ok:false — marker TYLKO w podglądzie (spec §3.4)", () => {
  const zly = {
    ok: false,
    bledy: [
      { klasa: "pole_niezgodne:udzial", dzial: "I-Sp" },
      { klasa: "kw_cyfra_kontrolna:kwGruntu" },
    ],
    kanal: "tekst" as const,
    plikow: 0,
    at: "2026-09-21T10:00:00.000Z",
  };
  const inputs = (): Partial<KcsInput> => ({
    kw: { ...EXAMINED_LOKAL, tresc: transcribedBook(), transkrypcja: zly },
    kwGrunt: {
      ...EXAMINED_GRUNT,
      tresc: transcribedBook(),
      transkrypcja: { ...zly, bledy: [{ klasa: "pesel_suma", dzial: "II" }] },
    },
  });
  const build = (preview: boolean) => {
    const base = syntheticDocumentInput();
    const full: KcsInput = { ...goldenInputs(), ...inputs() };
    return buildDocumentModel(
      {
        ...base,
        propertyRight: "wlasnosc_lokalu",
        inputs: full,
        kcs: computeKcs(full),
        author: AUTOR_TESTOWY,
      },
      { preview },
    );
  };

  it("podgląd: pierwszy wiersz każdej tabeli to marker z nazwami niezgodności po polsku, bez wartości", () => {
    const model = build(true);
    const [lokal] = model.ksiega_lokalu_wiersze;
    expect(lokal.typ).toBe("dzial");
    expect(lokal.kol1).toBe(previewMarkerRow(zly.bledy, "lokal").kol1);
    expect(lokal.kol1).toContain("[PODGLĄD: SPRAWDZENIE TREŚCI NIE WYPADŁO POMYŚLNIE]");
    expect(lokal.kol1).toContain(
      "udział w nieruchomości wspólnej, cyfra kontrolna numeru księgi gruntu",
    );
    expect(lokal.kol1).not.toContain(transcribedBook().polaDodatkowe.udzial!);
    expect(model.ksiega_gruntu_wiersze[0].kol1).toContain("numer PESEL w dziale II");
    // Reszta tabeli nietknięta: po markerze idzie pierwszy dział.
    expect(model.ksiega_lokalu_wiersze[1].kol1).toBe(transcribedBook().dzialy[0].tytul);
  });

  it("wydany operat: żadnego markera, tabela zaczyna się od działu I-O", () => {
    const model = build(false);
    expect(model.ksiega_lokalu_wiersze[0].kol1).toBe(transcribedBook().dzialy[0].tytul);
    expect(JSON.stringify(model)).not.toContain("[PODGLĄD: SPRAWDZENIE");
  });

  it("werdykt ok:true nie daje markera nawet w podglądzie", () => {
    const model = modelOf({
      kw: {
        ...EXAMINED_LOKAL,
        tresc: transcribedBook(),
        transkrypcja: { ...zly, ok: true, bledy: [] },
      },
    });
    expect(model.ksiega_lokalu_wiersze[0].kol1).toBe(transcribedBook().dzialy[0].tytul);
  });
});
