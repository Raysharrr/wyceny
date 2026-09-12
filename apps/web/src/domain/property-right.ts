/**
 * Rodzaj prawa do lokalu (T-12, blok "Prawo spółdzielcze"). Pure domain —
 * no I/O, no adapters (F-10). `wlasnosc_lokalu` is the only behaviour the
 * app had before this block and the column default for every existing
 * valuation; `spoldzielcze_wlasnosciowe` swaps the wording, drops the
 * KW-gruntu requirement and (later, S3) switches the comparable source to
 * the office coop registry.
 *
 * Every text below is verbatim from the Piastowskie operat (wiki research
 * 2026-09-12 "logika operatu spółdzielczego" §1.1) — except the publikator
 * of the coop act, deliberately a placeholder: the operat's own citation is
 * suspected to be a copy-paste error (spec §4.5).
 */
export const PROPERTY_RIGHTS = ["wlasnosc_lokalu", "spoldzielcze_wlasnosciowe"] as const;
export type PropertyRight = (typeof PROPERTY_RIGHTS)[number];

export const PROPERTY_RIGHT_LABEL: Record<PropertyRight, string> = {
  wlasnosc_lokalu: "Własność lokalu",
  spoldzielcze_wlasnosciowe: "Spółdzielcze własnościowe prawo do lokalu",
};

export type PropertyRightDoc = {
  /** Subject-of-valuation phrase: "prawo …" (nominative) / "prawa …" (genitive). */
  przedmiot: { mianownik: string; dopelniacz: string };
  /** Entries for §5 "Podstawy prawne" specific to this right. */
  podstawyPrawne: string[];
  /** Sentences always inserted for this right (§1, §2, §8.2). */
  klauzule: string[];
  /** Sentence inserted only when step 1 says the lokal has a basement; null = none for this right. */
  klauzulaPiwnicy: string | null;
  /** Whether the approval gate demands the KW gruntu (księga macierzysta) number. */
  wymagaKwGruntu: boolean;
  /** Whether the approval gate demands the KW lokalu number (a coop right has no księga of its own). */
  wymagaKwLokalu: boolean;
};

export const PROPERTY_RIGHT_DOC: Record<PropertyRight, PropertyRightDoc> = {
  wlasnosc_lokalu: {
    przedmiot: {
      mianownik: "prawo własności nieruchomości lokalowej",
      dopelniacz: "prawa własności nieruchomości lokalowej",
    },
    // Same citation the current DOCX template prints (tools/spike/2026-06-05-template-seed).
    podstawyPrawne: ["Ustawa z dnia 24 czerwca 1994 r. o własności lokali (Dz.U. 2026, poz. 39)"],
    klauzule: [],
    // A basement under własność is a KW fact (przynależność with its own area) — it
    // comes from the extract, not from a fixed sentence.
    klauzulaPiwnicy: null,
    wymagaKwGruntu: true,
    wymagaKwLokalu: true,
  },
  spoldzielcze_wlasnosciowe: {
    przedmiot: {
      mianownik: "spółdzielcze własnościowe prawo do lokalu mieszkalnego",
      dopelniacz: "spółdzielczego własnościowego prawa do lokalu mieszkalnego",
    },
    podstawyPrawne: [
      "Ustawa z dnia 15 grudnia 2000 r. o spółdzielniach mieszkaniowych (Dz. U. — publikator do uzupełnienia)",
    ],
    klauzule: [
      "Dla spółdzielczego własnościowego prawa do lokalu mieszkalnego nie założono księgi wieczystej.",
    ],
    klauzulaPiwnicy:
      "Właściciele spółdzielczego własnościowego prawa mają możliwość korzystania z piwnicy, nie jest ona jednak objęta w/w prawem i nie stanowi prawa majątkowego.",
    wymagaKwGruntu: false,
    wymagaKwLokalu: false,
  },
};
