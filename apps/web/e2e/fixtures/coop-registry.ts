import { buildXlsxFromSheets, type Cell } from "../../tests/fixtures/xlsx-writer.js";

/**
 * Per-run synthetic register for the cooperative-right E2E.
 *
 * Every run gets its own `runId`, and the run id is folded into the flat
 * numbers and prices, so the content-based dedup key (`coopDedupeKey` — no
 * cooperative name in it) never collides with rows a previous run left in the
 * register. That is what makes "import adds N rows" repeatable on a shared
 * database (CI job, or the staging register the QA checklist uses).
 *
 * Addresses are REAL Rataje estate names with fictional building/flat numbers:
 * the CI geocoder stub (`GEOCODER_STUB=1`) hashes any text, and on staging the
 * live geocoder resolves the estate. Nothing here is client data.
 */
export type RegistryRun = {
  runId: string;
  cooperative: string;
  /** Sheet A — header row 3 (two title rows above), Lp. | Adres | Nr budynku | Nr mieszkania | Powierzchnia | Cena | Data | Prawo */
  sheetA: { name: string; headerRow: "2"; rows: number; inBand43: number };
  /** Sheet B — a different layout: Rep. aktu | Data sprzedaży | Lokal | Pow. | Cena (address+building+flat in one cell) */
  sheetB: { name: string; headerRow: "0"; rows: number };
  xlsx: Buffer;
};

const ESTATES = [
  "os. Piastowskie",
  "os. Jagiellońskie",
  "os. Oświecenia",
  "os. Rzeczypospolitej",
  "os. Armii Krajowej",
  "os. Lecha",
  "os. Czecha",
  "os. Tysiąclecia",
];

export function newRunId(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`.slice(-8);
}

export function buildRegistryRun(runId = newRunId()): RegistryRun {
  const seed = Array.from(runId).reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 100_003, 7);
  const rowsA: Cell[][] = [];
  // 18 rows in the 43 m² band (±30 % → 30,3–56,3 m²) feed a full 20-row sample once the
  // radius walk reaches 3 km; 6 large rows sit outside that band, so the step-3 banner
  // shows a real band cut („N z M pasujących”) instead of a pool that passes whole.
  const areas = [
    ...[
      38.2, 43.34, 43.7, 45.5, 47.9, 48.4, 52.1, 54.3, 40.0, 42.6, 44.9, 46.3, 49.7, 51.2, 53.0,
      55.4, 39.5, 41.8,
    ],
    ...[75.0, 78.4, 80.2, 82.9, 85.5, 88.0],
  ];
  areas.forEach((area, i) => {
    const estate = ESTATES[(seed + i) % ESTATES.length]!;
    const building = 1 + ((seed + 7 * i) % 40);
    const flat = 1 + ((seed + 13 * i) % 120);
    const unit = 9_600 + ((seed + 37 * i) % 900); // zł/m², well inside one price band
    const price = Math.round((area * unit) / 1000) * 1000;
    const month = 1 + (i % 12);
    rowsA.push([
      i + 1,
      estate,
      String(building),
      String(flat),
      String(area).replace(".", ","),
      String(price),
      `2025-${String(month).padStart(2, "0")}-${String(1 + (i % 27)).padStart(2, "0")}`,
      i % 3 === 0 ? "" : "spółdzielcze własnościowe",
    ]);
  });
  const dup = [...rowsA[9]!];
  dup[0] = rowsA.length + 1; // same content, other Lp. → the parser must drop it as a duplicate
  const sheetA = {
    name: `Rejestr QA ${runId}`,
    rows: [
      [`WYKAZ SPRZEDAŻY LOKALI — DANE SYNTETYCZNE E2E ${runId}`],
      [],
      ["Lp.", "Adres", "Nr budynku", "Nr mieszkania", "Powierzchnia", "Cena", "Data", "Prawo"],
      ...rowsA,
      dup,
      ["", "SUMA", "", "", "", String(rowsA.reduce((s, r) => s + Number(r[5]), 0)), "", ""],
    ],
  };
  const sheetB = {
    name: "Inny układ",
    rows: [
      ["Rep. aktu", "Data sprzedaży", "Lokal", "Pow. [m2]", "Cena [zł]"],
      ...[0, 1, 2, 3].map((i) => [
        `Rep. A nr ${1000 + ((seed + i) % 9000)}/${runId}`,
        `2025-0${3 + i}-1${i}`,
        `${ESTATES[(seed + 3 * i) % ESTATES.length]} ${5 + i}/${20 + ((seed + i) % 50)}`,
        "45,5",
        String(410_000 + i * 1000),
      ]),
    ],
  };
  return {
    runId,
    cooperative: `SM QA E2E ${runId}`,
    sheetA: { name: sheetA.name, headerRow: "2", rows: rowsA.length, inBand43: 18 },
    sheetB: { name: sheetB.name, headerRow: "0", rows: 4 },
    xlsx: buildXlsxFromSheets([sheetA, sheetB]),
  };
}

/** Column indexes of sheet A, keyed by the wizard's field labels. */
export const MAPPING_A = {
  "Adres (ulica / osiedle)": "1",
  "Nr budynku": "2",
  "Nr mieszkania": "3",
  "Powierzchnia [m²]": "4",
  "Cena [zł]": "5",
  "Data transakcji": "6",
  "Rodzaj prawa": "7",
} as const;

/** Sheet B: address, building and flat all point at the one "Lokal" column. */
export const MAPPING_B = {
  "Rep. aktu": "0",
  "Data transakcji": "1",
  "Adres (ulica / osiedle)": "2",
  "Nr budynku": "2",
  "Nr mieszkania": "2",
  "Powierzchnia [m²]": "3",
  "Cena [zł]": "4",
} as const;
