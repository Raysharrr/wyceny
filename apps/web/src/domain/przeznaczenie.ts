import type { PrzeznaczenieRodzaj, SubjectSnapshot } from "./subject-snapshot";

/**
 * Whether §9 can print its source sentence. The ONE rule, read by both the
 * approval gate (B-02) and the document model — so the operat can never print
 * a sentence the gate would have refused, nor stay silent about something the
 * gate let through.
 */
export function isPrzeznaczenieComplete(subject: SubjectSnapshot | null | undefined): boolean {
  return Boolean(
    subject?.przeznaczenieRodzaj &&
    subject.przeznaczenieNazwa &&
    subject.przeznaczenieUchwala &&
    subject.przeznaczenieData &&
    subject.przeznaczenieSymbol,
  );
}

/**
 * Plan ogólny miasta Poznania — the one resolution every Poznań valuation
 * without an MPZP cites since 14.01.2026. Verbatim from operats Folwarczna and
 * Wojska Polskiego (§7 poz. 1 and §9). Offered as a prefill, never forced: the
 * appraiser overwrites it the day the city passes a new one, and only the
 * resolution is prefilled — never the symbol, which is read off the map for
 * THIS parcel (Folwarczna is 742SW, a neighbouring block is not).
 */
export const PLAN_OGOLNY_POZNAN = {
  nazwa: "miasta Poznania",
  uchwala: "Nr XXIX/529/IX/2025 Rady Miasta Poznania",
  data: "2025-12-18",
  publikator:
    "obowiązujący od 14 stycznia 2026 r. (opublikowany w dniu 30.12.2025 r. " +
    "w Dzienniku Urzędowym Województwa Wielkopolskiego z 2025 r. poz. 9903)",
} as const;

/** TERYT prefix of powiat m. Poznań — the same gate the worker's coverage uses. */
const POZNAN_TERYT_PREFIX = "3064";

/**
 * Whether the Poznań plan ogólny applies. TERYT when the auto-fetch ran, the
 * address otherwise — the 14.09 valuation was entered by hand and had no
 * snapshot at all, which is exactly the case the prefill has to reach.
 */
export function isPoznan(address: string, teryt?: string | null): boolean {
  if (teryt) return teryt.startsWith(POZNAN_TERYT_PREFIX);
  return /pozna[nń]/i.test(address);
}

/** Field labels per branch — §9 reads each source with its own noun and case. */
export const PRZEZNACZENIE_LABEL: Record<PrzeznaczenieRodzaj, string> = {
  mpzp: "Miejscowy plan zagospodarowania przestrzennego",
  plan_ogolny: "Plan ogólny gminy",
  studium: "Studium (gmina bez planu ogólnego)",
};

/**
 * What goes in `przeznaczenieNazwa`. MPZP names the plan; the other two name
 * the gmina, in the genitive the sentence needs ("…przestrzennego Gminy
 * Swarzędz", "…Planu ogólnego miasta Poznania").
 */
export const PRZEZNACZENIE_NAZWA_LABEL: Record<PrzeznaczenieRodzaj, string> = {
  mpzp: "Nazwa planu",
  plan_ogolny: "Gmina / miasto (dopełniacz)",
  studium: "Gmina (dopełniacz)",
};

export const PRZEZNACZENIE_NAZWA_PLACEHOLDER: Record<PrzeznaczenieRodzaj, string> = {
  mpzp: 'np. „Jeżyce – Północ" część C w Poznaniu',
  plan_ogolny: "np. miasta Poznania",
  studium: "np. Gminy Swarzędz",
};
