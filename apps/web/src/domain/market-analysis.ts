/**
 * §11 "Analiza i charakterystyka rynku", composed from the valuation's data
 * (M-12). Pure: no I/O, no clock.
 *
 * Until 16.09 a language model wrote this section. Every one of the ten
 * reference operats of the office writes it as a FORMULA over the selection's
 * data — intro, selection criteria, the collected set, what was rejected, the
 * sample — so the model added nothing but risk: it copied whatever facts it
 * was given (the 14.09 operat stated the SAMPLE's area spread as the selection
 * criterion, D-39, and "przebadano ponad tysiąc" counted a 3 km square, not
 * the studied radius), and it could not place two data paragraphs between its
 * own bullets and its own sample paragraph.
 *
 * The inflection a formula needs is small and closed — a count, a list of
 * obręby, a list of rejection criteria — so every variant is enumerable and
 * pinned by `market-analysis.test.ts`. The text still reaches step 6 as a
 * proposal the appraiser reads, edits and confirms, like every other section.
 *
 * Deliberately neutral about the property right ("lokal mieszkalny",
 * "przedmiot wyceny"): the same sentences are true for ownership and for the
 * cooperative right, so there is no noun to agree.
 */
import { cityFromAddress, formatNumber, formatPln } from "./document-model";
import { plural } from "./plural";
import { buildProseFacts, type ProseFactsInput } from "./prose";
import type { SampleSelectionSnapshot } from "./sample-snapshot";
import { DEFAULTS } from "./sample-selection";

/** "A", "A oraz B", "A, B oraz C" — the operat's own conjunction for lists. */
export function listPl(items: string[], last: string): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${last} ${items[items.length - 1]}`;
}

export function obrebyPhrase(obreby: string[]): string {
  return obreby.length === 1 ? `obręb ${obreby[0]}` : `obręby ${listPl(obreby, "i")}`;
}

const m2 = (value: number) => `${formatNumber(value, 2)} m2`;

/**
 * The area criterion the selection actually applied: the appraiser's own
 * range (either bound may be open) or the default band around the subject's
 * area. `areaBandPct` is not persisted in the snapshot — the selection always
 * runs on the default, so the default is what it applied.
 */
function areaCriterion(sel: SampleSelectionSnapshot): { lo?: number; hi?: number } {
  const own = sel.params.areaRange;
  if (own && (own.min !== undefined || own.max !== undefined)) return { lo: own.min, hi: own.max };
  const { subjectArea } = sel.params;
  return {
    lo: subjectArea * (1 - DEFAULTS.areaBandPct),
    hi: subjectArea * (1 + DEFAULTS.areaBandPct),
  };
}

function areaRangeText({ lo, hi }: { lo?: number; hi?: number }): string {
  if (lo !== undefined && hi !== undefined) return `od ${m2(lo)} do ${m2(hi)}`;
  return lo !== undefined ? `od ${m2(lo)}` : `do ${m2(hi!)}`;
}

function areaRejectedText({ lo, hi }: { lo?: number; hi?: number }): string {
  const parts = [
    lo !== undefined ? `poniżej ${m2(lo)}` : null,
    hi !== undefined ? `powyżej ${m2(hi)}` : null,
  ].filter((p): p is string => p !== null);
  return `lokale o powierzchni użytkowej ${parts.join(" i ")}`;
}

/** The section's text, paragraphs separated by a blank line; "" without a usable sample. */
export function composeMarketAnalysis(input: ProseFactsInput): string {
  const facts = buildProseFacts(input);
  const p = facts.proba;
  if (!p) return "";
  const city = cityFromAddress(input.address);
  const sel = input.inputs.sampleSelection ?? null;
  const criterion = sel ? areaCriterion(sel) : null;

  const intro =
    `Dla określenia wartości rynkowej wycenianego lokalu o funkcji mieszkalnej przeprowadzono ` +
    `analizę rynku lokalnego m. ${city}${facts.obreb ? `, obręb ${facts.obreb}` : ""}, ` +
    `ze szczególnym uwzględnieniem lokalizacji lokalu stanowiącego przedmiot wyceny.`;

  const years = DEFAULTS.windowMonths / 12;
  const bullets = [
    "zakres przedmiotowy – rynek wtórny lokali mieszkalnych",
    `obszar badania – m. ${city}` +
      (p.obreby?.length ? `, ${obrebyPhrase(p.obreby)}` : "") +
      (p.promien_m ? `, w promieniu ${formatNumber(p.promien_m, 0)} m od wycenianego lokalu` : ""),
    // Criteria, not results (D-39). A hand-entered sample has no selection
    // behind it, so the accepted transactions' own span is all there is.
    criterion
      ? `powierzchnia użytkowa – ${areaRangeText(criterion)}`
      : p.pow_min_m2
        ? `powierzchnia użytkowa – od ${p.pow_min_m2} m2 do ${p.pow_max_m2} m2`
        : null,
    sel
      ? `zakres czasowy badania – ${years} ${plural(years, "rok", "lata", "lat")} wstecz od daty wyceny`
      : p.zakres_dat
        ? `zakres czasowy badania – transakcje z okresu ${p.zakres_dat}`
        : null,
  ].filter((b): b is string => b !== null);
  const criteria =
    "Cechy analizowanego rynku:\n" +
    bullets.map((b, i) => `• ${b}${i === bullets.length - 1 ? "." : ","}`).join("\n");

  const paragraphs = [intro, criteria];

  // The collected set and its rejections (M-12). Absent on selections made
  // before 16.09 — those print §11 without both paragraphs (decision A).
  const pool = sel?.poolStats;
  if (pool) {
    paragraphs.push(
      `W okresie monitorowania rynku lokalnego odnotowano transakcje na badanym terenie, ` +
        `w których wystąpiła sprzedaż lokali mieszkalnych. Powierzchnia użytkowa lokali wynosiła ` +
        `od ${m2(pool.areaMin)} do ${m2(pool.areaMax)}. Jednostkowe ceny transakcyjne znajdowały się ` +
        `w przedziale od ${formatPln(pool.unitPriceMin)} zł do ${formatPln(pool.unitPriceMax)} zł ` +
        `za 1 m2 powierzchni użytkowej lokalu. Średnia cena została ustalona na poziomie ` +
        `${formatPln(pool.unitPriceMean)} zł za 1 m2. Ceny transakcyjne kształtowały się ` +
        `od ${formatNumber(pool.totalMin, 0)} zł do ${formatNumber(pool.totalMax, 0)} zł. ` +
        `Średnia cena wyniosła ${formatNumber(pool.totalMean, 0)} zł.`,
    );
    // No counts and no price threshold: 0 of 10 reference operats print
    // either (D9) — a price band is named only as "odbiegające ceną".
    const rejected = [
      pool.excluded.shares ? "transakcje dotyczące udziałów w lokalach" : null,
      pool.excluded.area && criterion ? areaRejectedText(criterion) : null,
      pool.excluded.price ? "lokale odbiegające ceną od średniej ceny transakcyjnej" : null,
    ].filter((r): r is string => r !== null);
    if (rejected.length > 0) {
      paragraphs.push(
        `W toku analizy odrzucono ${listPl(rejected, "oraz")}. ` +
          `Powyższe transakcje nie wykazywały cech podobieństwa do przedmiotu wyceny.`,
      );
    }
  }

  const n = p.liczba_transakcji;
  paragraphs.push(
    `Do porównań przyjęto ${n} ` +
      plural(
        n,
        "transakcję dotyczącą lokalu",
        "transakcje dotyczące lokali",
        "transakcji dotyczących lokali",
      ) +
      (p.pow_min_m2 ? ` o powierzchni użytkowej od ${p.pow_min_m2} m2 do ${p.pow_max_m2} m2` : "") +
      `. Jednostkowe ceny transakcyjne znajdowały się w przedziale od ${p.cena_min_zl_m2} zł ` +
      `do ${p.cena_max_zl_m2} zł za 1 m2 powierzchni użytkowej lokalu. Średnia cena jednostkowa ` +
      `została ustalona na poziomie ${p.cena_srednia_zl_m2} zł za 1 m2.` +
      (p.cena_calkowita_min_zl
        ? ` Ceny całkowite lokali przyjętych do porównań zawierały się w przedziale ` +
          `od ${p.cena_calkowita_min_zl} zł do ${p.cena_calkowita_max_zl} zł.`
        : ""),
  );

  return paragraphs.join("\n\n");
}
