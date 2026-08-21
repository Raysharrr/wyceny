/**
 * One-off: Poznań obręb code → name, from GEOPOZ GetFeatureInfo (layer
 * `dzialki`, field NAZWA_OBREBU — the same request apps/worker/app/subject.py
 * makes for the subject parcel). Input points: one candidate `pos` per obręb
 * code found in the frozen F-14 RCN snapshots. Run: `pnpm tsx scripts/fetch-obreby.mts`
 * (from apps/web). Output: src/domain/obreby-poznan.json. Codes outside
 * Poznań (teryt prefix ≠ 3064) are skipped — the UI shows them as code + gmina.
 */
import { writeFileSync } from "node:fs";
import { loadSnapshot } from "../tests/fixtures/rcn-snapshots/load";

const SLUGS = [
  "koscielna",
  "meissnera",
  "olga",
  "starolecka",
  "wojska-polskiego",
  "heweliusza",
  "sielawy",
];
const GEOPOZ = "https://portal.geopoz.poznan.pl/wmsegib";
const points = new Map<string, { x: number; y: number }>();
for (const slug of SLUGS) {
  for (const c of loadSnapshot(slug).candidates) {
    if (c.egib && c.pos && c.egib.teryt.startsWith("3064") && !points.has(c.egib.obreb))
      points.set(c.egib.obreb, c.pos);
  }
}
const out: Record<string, string> = {};
for (const [code, { x, y }] of [...points.entries()].sort()) {
  const half = 50;
  const q = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetFeatureInfo",
    LAYERS: "dzialki",
    QUERY_LAYERS: "dzialki",
    CRS: "EPSG:2180",
    BBOX: `${y - half},${x - half},${y + half},${x + half}`,
    WIDTH: "256",
    HEIGHT: "256",
    I: "128",
    J: "128",
    INFO_FORMAT: "text/xml",
    FEATURE_COUNT: "10",
  });
  const xml = await (await fetch(`${GEOPOZ}?${q}`)).text();
  const m = /<NAZWA_OBREBU>([^<]*)<\/NAZWA_OBREBU>/.exec(xml);
  const codeInXml =
    /<(?:NUMER_OBREBU|OBREB|ID_OBREBU)>0*(\d+)<\/(?:NUMER_OBREBU|OBREB|ID_OBREBU)>/.exec(xml);
  if (!m) {
    console.warn(`obręb ${code}: brak NAZWA_OBREBU (punkt ${x},${y})`);
    continue;
  }
  const name = m[1]
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/(^|[\s-])\S/g, (s) => s.toUpperCase());
  if (codeInXml && codeInXml[1].padStart(4, "0") !== code)
    console.warn(`obręb ${code}: GEOPOZ zwrócił ${codeInXml[1]} — sprawdź`);
  out[code] = name;
  console.log(code, name);
  await new Promise((r) => setTimeout(r, 150));
}
writeFileSync(
  "src/domain/obreby-poznan.json",
  JSON.stringify(
    {
      _source: `GEOPOZ wmsegib GetFeatureInfo dzialki/NAZWA_OBREBU, ${new Date().toISOString().slice(0, 10)}, punkty z tests/fixtures/rcn-snapshots`,
      ...out,
    },
    null,
    2,
  ) + "\n",
);
console.log(`zapisano ${Object.keys(out).length} obrębów`);
