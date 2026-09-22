import type { KsiegaTresc } from "./kw-tresc";
import type { KwAkt, KwGruntSnapshot, KwSnapshot } from "./kw-snapshot";

/**
 * The transcription's own reading of the book, as snapshot fields
 * (b1-kw-read). `/kw-transcribe` returns `polaDodatkowe` next to the five
 * dzialy: the same handful of facts `/kw-extract` reads, but taken from a
 * full-fidelity pass over the whole document and checked by the worker's
 * deterministic validators against the transcribed rubrics.
 *
 * Pure (F-10). Lives beside the two types it joins rather than inside either,
 * so neither `kw-snapshot` nor `kw-tresc` has to import the other.
 */

/** The "number/year" core of a Rep. A entry — the same shape `kw_validate.py` matches on. */
const REP_CORE_RX = /\d+\s*\/\s*\d+/;

/**
 * The eKW document line opens with the kind of instrument ("AKT NOTARIALNY,
 * UMOWA SPRZEDAŻY"), and the model sometimes carries that opening into
 * `tytulAktu` and sometimes not — the prompt does not pin the spelling
 * (measured in review #51). The operat's §7 sentence supplies the deed noun
 * itself and then prints `rodzaj`, so an unstripped prefix reads twice.
 */
const AKT_PREFIX_RX = /^akt\s+notarialny\s*[,;:–—-]\s*/i;

/** Trailing separators an eKW cell leaves behind when the line was split. */
const TRAILING_PUNCT_RX = /[\s,;:]+$/;

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * "REP. A NR 6497/2018" → "6497/2018". A value with no number/year core is
 * returned as written: it is still what the book says, and a field emptied by
 * a normalizer is worse than one the appraiser can see and correct.
 */
export function normalizeRepA(raw: string): string {
  const core = REP_CORE_RX.exec(raw);
  return core ? core[0].trim() : raw.trim();
}

/**
 * "AKT NOTARIALNY, UMOWA SPRZEDAŻY" → "UMOWA SPRZEDAŻY". A title that is only
 * the deed kind keeps it — stripping would leave an empty field, and "the
 * book names a deed but not which kind" is a fact worth printing.
 */
export function normalizeTytulAktu(raw: string): string {
  const stripped = raw.trim().replace(AKT_PREFIX_RX, "").replace(TRAILING_PUNCT_RX, "");
  return stripped || raw.trim().replace(TRAILING_PUNCT_RX, "");
}

/**
 * Dział II's "Dokumenty będące podstawą wpisu" as the operat's three fields
 * (ADR-018 reg. 1, D-12). `null` when the section names no document, or names
 * one with nothing in any of the three parts — same rule as `normalizeAkt`,
 * because "no deed recorded" and "a deed rendering as an empty sentence" are
 * different claims. A PARTLY filled deed survives as read: §7 prints what is
 * there, and the appraiser completes the rest.
 *
 * The notary and their seat are deliberately dropped: §7 names the deed, not
 * the office that drew it, and the snapshot has no field for them.
 */
export function aktZTresci(tresc: KsiegaTresc): KwAkt | null {
  const podstawa = tresc.polaDodatkowe.podstawaNabycia;
  if (podstawa == null) return null;
  const rodzaj = trimToNull(podstawa.tytulAktu);
  const rep = trimToNull(podstawa.repA);
  const data = trimToNull(podstawa.dataAktu);
  if (rodzaj == null && rep == null && data == null) return null;
  return {
    rodzaj: rodzaj ? normalizeTytulAktu(rodzaj) : "",
    rep: rep ? normalizeRepA(rep) : "",
    // ISO as the worker returns it (RRRR-MM-DD), like `dataBadania`. The
    // document model is the one place that turns a date into DD.MM.YYYY.
    data: data ?? "",
  };
}

/**
 * Every snapshot field the transcription can fill. `sad`/`wydzial` come from
 * the printout's header rather than `polaDodatkowe`, which is where eKW puts
 * them.
 */
export function polaZTresci(
  tresc: KsiegaTresc,
): Pick<KwSnapshot, "nrLokalu" | "udzial" | "kwGruntu" | "sad" | "wydzial" | "akt"> {
  return {
    nrLokalu: trimToNull(tresc.polaDodatkowe.numerLokalu),
    // Verbatim, spaces around "/" and all: the share is the register's text.
    udzial: trimToNull(tresc.polaDodatkowe.udzial),
    kwGruntu: trimToNull(tresc.polaDodatkowe.kwGruntu),
    sad: trimToNull(tresc.naglowek.sad),
    wydzial: trimToNull(tresc.naglowek.wydzial),
    akt: aktZTresci(tresc),
  };
}

const SEP_WARTOSCI = " | ";

/**
 * Działy III i IV WYLICZANE z treści (ADR-021 reg. 1, refaktor R1) — jedno
 * źródło prawdy o działach zamiast pola wpisywanego ręcznie obok transkrypcji.
 * Dział nieobecny w treści zostaje `null` (nieodpowiedziany): wklejenie trzech
 * zakładek z pięciu nie może wyprodukować „brak wpisów” o dziale, którego
 * nikt nie przepisał — to ten sam błąd, co operat z 14.09.
 */
export function dzialyZTresci(tresc: KsiegaTresc): Pick<KwSnapshot, "dzial3" | "dzial4"> {
  const dzial = (kod: "III" | "IV") => {
    const d = tresc.dzialy.find((x) => x.kod === kod);
    if (!d) return null;
    if (d.brakWpisow) return { wpisy: false, tresc: [] };
    return {
      wpisy: true,
      tresc: d.tabele.flatMap((t) =>
        t.wpisy.flatMap((w) =>
          w.rubryki.map((r) => `${r.nazwa}: ${r.wartosci.join(SEP_WARTOSCI)}`),
        ),
      ),
    };
  };
  return { dzial3: dzial("III"), dzial4: dzial("IV") };
}

/** Numer księgi, którą przepisano — nagłówek, a gdy go nie ma, pole dodatkowe. */
export function numerKsiegiZTresci(tresc: KsiegaTresc): string | null {
  return trimToNull(tresc.naglowek.numerKsiegi) ?? trimToNull(tresc.polaDodatkowe.kwLokalu);
}

/** Karta gruntu z kanału tekstowego lub PDF: wszystko, co ma, bierze z nagłówka. */
export function polaGruntuZTresci(
  tresc: KsiegaTresc,
): Pick<KwGruntSnapshot, "nrKsiegi" | "sad" | "wydzial"> {
  return {
    nrKsiegi: trimToNull(tresc.naglowek.numerKsiegi),
    sad: trimToNull(tresc.naglowek.sad),
    wydzial: trimToNull(tresc.naglowek.wydzial),
  };
}
