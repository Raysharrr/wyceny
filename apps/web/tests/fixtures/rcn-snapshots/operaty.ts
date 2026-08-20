/**
 * Reference data for spike A — ported from tools/spike/2026-05-14-kcs/spike.py
 * (dictionary OPERATY: addresses, areas, WR from the PDFs, feature weights and
 * ratings, Aneta's comparables table from each PDF) + two staging test
 * addresses from the 2026-08-20 feedback (no PDF, no WR — ranking diagnostics only).
 *
 * Ratings convention (PDF): "wartość najwyższa" → lepsza, "najniższa" → gorsza,
 * "pośrednia" → przecietna.
 */

import type { Feature } from "../../../src/domain/kcs";

export type PdfRow = { month: string; area: number; pricePerM2: number };

export type Operat = {
  slug: string;
  /** UUG-shaped query: "Poznań, Ulica nr". */
  uugAddress: string;
  displayAddress: string;
  valuationDate: string;
  /** Valuation month — the clock for selectSample. */
  todayMonth: string;
  area: number;
  pdfWrUnrounded: number | null;
  pdfWrRounded: number | null;
  pdfCsr: number | null;
  features: Feature[];
  /** Aneta's comparables table from the PDF (Tabela 1). */
  pdfSample: PdfRow[];
  /** Export file (extracted text) with Aneta's candidate list, if any. */
  evaluerFile: string | null;
};

const f = (name: string, weight: number, rating: Feature["rating"]): Feature => ({
  name,
  weight,
  rating,
});

export const OPERATY: Operat[] = [
  {
    slug: "koscielna",
    uugAddress: "Poznań, Kościelna 33A",
    displayAddress: "Poznań, ul. Kościelna 33A",
    valuationDate: "2026-03-26",
    todayMonth: "2026-03",
    area: 71.63,
    pdfWrUnrounded: 1_044_413,
    pdfWrRounded: 1_044_400,
    pdfCsr: 13123.6,
    features: [
      f("standard_wykonczenia", 0.4, "lepsza"),
      f("pietro", 0.3, "lepsza"),
      f("powierzchnia", 0.1, "gorsza"),
      f("dodatkowe", 0.1, "lepsza"),
      f("lokalizacja", 0.1, "lepsza"),
    ],
    pdfSample: [
      ["2024-07", 63.27, 14698.91],
      ["2024-06", 61.35, 12061.94],
      ["2024-04", 76.41, 12629.24],
      ["2024-07", 62.44, 12652.15],
      ["2024-10", 61.62, 12788.06],
      ["2024-09", 70.02, 14852.9],
      ["2025-02", 61.51, 13168.59],
      ["2025-02", 64.28, 14452.4],
      ["2025-06", 71.65, 12281.93],
      ["2025-12", 70.76, 13566.99],
      ["2025-11", 62.15, 12228.48],
      ["2025-11", 74.37, 12101.65],
    ].map(([month, area, pricePerM2]) => ({
      month: month as string,
      area: area as number,
      pricePerM2: pricePerM2 as number,
    })),
    evaluerFile: "wycena-koscielna.xlsx.txt",
  },
  {
    slug: "meissnera",
    uugAddress: "Poznań, Janusza Meissnera 6A",
    displayAddress: "Poznań, ul. Janusza Meissnera 6A",
    valuationDate: "2026-04-23",
    todayMonth: "2026-04",
    area: 55.8,
    pdfWrUnrounded: 745_522.6,
    pdfWrRounded: 745_500,
    pdfCsr: 12797.53,
    features: [
      f("standard_wykonczenia", 0.4, "lepsza"),
      f("pietro", 0.2, "przecietna"),
      f("powierzchnia", 0.3, "lepsza"),
      f("dodatkowe", 0.1, "gorsza"),
    ],
    pdfSample: [
      ["2024-05", 54.24, 12905.6],
      ["2024-07", 50.33, 13709.52],
      ["2024-05", 68.73, 12221.74],
      ["2025-03", 55.16, 12599.71],
      ["2025-03", 68.19, 12758.47],
      ["2024-10", 51.78, 13518.73],
      ["2024-10", 67.04, 13350.24],
      ["2024-04", 49.95, 12012.01],
      ["2026-02", 67.84, 13708.73],
      ["2026-01", 57.16, 12508.75],
      ["2026-01", 69.2, 12283.24],
      ["2025-12", 53.01, 12733.45],
      ["2025-08", 62.6, 12460.06],
      ["2025-06", 52.44, 12395.12],
    ].map(([month, area, pricePerM2]) => ({
      month: month as string,
      area: area as number,
      pricePerM2: pricePerM2 as number,
    })),
    evaluerFile: "wycena-meissnera.xlsx.txt",
  },
  {
    slug: "olga",
    uugAddress: "Poznań, Olgi Sławskiej-Lipczyńskiej 6",
    displayAddress: "Poznań, ul. Olgi Sławskiej-Lipczyńskiej 6",
    valuationDate: "2026-03-05",
    todayMonth: "2026-03",
    area: 84.25,
    pdfWrUnrounded: 1_109_109.12,
    pdfWrRounded: 1_109_100,
    pdfCsr: 12731.63,
    features: [
      f("lokalizacja_szczegolowa", 0.1, "lepsza"),
      f("powierzchnia", 0.2, "gorsza"),
      f("standard_wykonczenia", 0.3, "lepsza"),
      f("pietro", 0.3, "lepsza"),
      f("dodatkowe", 0.1, "lepsza"),
    ],
    pdfSample: [
      ["2024-03", 92.28, 12998.48],
      ["2024-03", 72.62, 11842.47],
      ["2024-12", 89.69, 12810.79],
      ["2025-02", 68.38, 13220.24],
      ["2025-03", 61.48, 13500.33],
      ["2025-04", 71.94, 12228.94],
      ["2025-04", 64.05, 12099.92],
      ["2025-05", 62.51, 12537.99],
      ["2025-06", 65.59, 12959.29],
      ["2025-09", 66.51, 12704.86],
      ["2025-09", 76.91, 13213.37],
      ["2025-10", 71.43, 12736.25],
      ["2025-12", 61.62, 12658.23],
    ].map(([month, area, pricePerM2]) => ({
      month: month as string,
      area: area as number,
      pricePerM2: pricePerM2 as number,
    })),
    evaluerFile: null,
  },
  {
    slug: "starolecka",
    uugAddress: "Poznań, Starołęcka 34",
    displayAddress: "Poznań, ul. Starołęcka 34",
    valuationDate: "2026-03-31",
    todayMonth: "2026-03",
    area: 42.36,
    pdfWrUnrounded: 535_732,
    pdfWrRounded: 535_700,
    pdfCsr: 12314.63,
    features: [
      f("standard_wykonczenia", 0.4, "gorsza"),
      f("pietro", 0.1, "lepsza"),
      f("lokalizacja_szczegolowa", 0.1, "lepsza"),
      f("powierzchnia", 0.3, "lepsza"),
      f("dodatkowe", 0.1, "lepsza"),
    ],
    // 11 rows in the PDF, two of them printed twice (09-2024 68,04 and 12-2024 46,47).
    pdfSample: [
      ["2024-08", 57.49, 12837.02],
      ["2024-05", 80.76, 11131.75],
      ["2024-09", 68.04, 13374.49],
      ["2024-12", 46.47, 11835.59],
      ["2025-05", 67.78, 11507.82],
      ["2025-09", 54.44, 12123.44],
      ["2025-09", 54.04, 12157.66],
      ["2024-04", 48.46, 11659.1],
      ["2024-09", 68.04, 13374.49],
      ["2024-12", 46.47, 11835.59],
      ["2025-03", 62.39, 13623.98],
    ].map(([month, area, pricePerM2]) => ({
      month: month as string,
      area: area as number,
      pricePerM2: pricePerM2 as number,
    })),
    evaluerFile: "wycena-starolecka.xlsx.txt",
  },
  {
    slug: "wojska-polskiego",
    uugAddress: "Poznań, Wojska Polskiego 68",
    displayAddress: "Poznań, ul. Wojska Polskiego 68",
    valuationDate: "2026-03-25",
    todayMonth: "2026-03",
    area: 45.7,
    pdfWrUnrounded: 414_122.89,
    pdfWrRounded: 414_100,
    pdfCsr: 9764.84,
    features: [
      f("standard_wykonczenia", 0.4, "gorsza"),
      f("pietro", 0.2, "gorsza"),
      f("powierzchnia", 0.2, "gorsza"),
      f("lokalizacja", 0.1, "lepsza"),
      f("pom_przynalezne", 0.1, "lepsza"),
    ],
    pdfSample: [
      ["2024-06", 43.69, 10643.17],
      ["2024-07", 41.19, 10924.98],
      ["2024-07", 47.7, 9203.35],
      ["2024-05", 48.9, 8588.96],
      ["2024-06", 41.58, 10822.51],
      ["2024-10", 40.3, 9429.28],
      ["2025-06", 44.73, 10440.42],
      ["2025-04", 41.9, 9785.2],
      ["2025-08", 47.8, 8995.82],
      ["2026-01", 43.6, 10263.76],
      ["2026-01", 48.5, 9876.29],
      ["2026-01", 47.3, 8773.78],
      ["2025-12", 43.5, 9195.4],
    ].map(([month, area, pricePerM2]) => ({
      month: month as string,
      area: area as number,
      pricePerM2: pricePerM2 as number,
    })),
    evaluerFile: "wycena-wojska-polskiego.xlsx.txt",
  },
];

/** Staging test addresses (feedback 2026-08-20) — no PDF; ranking diagnostics vs v2 only. */
export const TEST_ADDRESSES: Operat[] = [
  {
    slug: "sielawy",
    uugAddress: "Poznań, Sielawy 21F",
    displayAddress: "Poznań, ul. Sielawy 21F/17",
    valuationDate: "2026-08-20",
    todayMonth: "2026-08",
    area: 92.34,
    pdfWrUnrounded: null,
    pdfWrRounded: null,
    pdfCsr: null,
    features: [],
    pdfSample: [],
    evaluerFile: null,
  },
  {
    slug: "heweliusza",
    uugAddress: "Poznań, Heweliusza 3",
    displayAddress: "Poznań, ul. Heweliusza 3/43",
    valuationDate: "2026-08-20",
    todayMonth: "2026-08",
    area: 50,
    pdfWrUnrounded: null,
    pdfWrRounded: null,
    pdfCsr: null,
    features: [],
    pdfSample: [],
    evaluerFile: null,
  },
];
