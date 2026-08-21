/**
 * EGiB identifier parsing — pure. RCN's `lok_id_lokalu` and GEOPOZ's
 * `ID_BUDYNKU` / ULDK parcel id share one grammar:
 *   TERYT.OBREB[.AR_ARKUSZ].DZIALKA[.BUDYNEK_BUD[.LOKAL_LOK]]
 * Poznań carries the `AR_` sheet segment, surrounding gminas don't (ADR-015 rule 3).
 */
export type Egib = {
  teryt: string;
  obreb: string;
  arkusz: string;
  dzialka: string;
  budynek: string;
  lokal: string;
};
export type SubjectEgib = { obreb: string; dzialka: string; arkusz?: string; budynek?: string };

const PARCEL_ID_RX = /^(\d{6}_\d)\.(\d+)\.(?:AR_(\d+)\.)?([^.]+)$/;
const BUILDING_ID_RX = /^(\d{6}_\d)\.(\d+)\.(?:AR_(\d+)\.)?([^.]+)\.(\d+)_BUD$/;
const LOKAL_ID_RX = /^(\d{6}_\d)\.(\d+)\.(?:AR_(\d+)\.)?([^.]+)\.(\d+)_BUD\.(.+)_LOK$/;

/** Obręb as RCN/GEOPOZ print it: 4 digits, zero-padded ("21" → "0021"). */
export function padObreb(obreb: string): string {
  return obreb.replace(/^0+/, "").padStart(4, "0");
}
const arkusz = (s: string | undefined) => (s ?? "").replace(/^0+/, "");

export function parseLokalId(id: string): Egib | null {
  const m = LOKAL_ID_RX.exec(id.trim());
  if (!m) return null;
  return {
    teryt: m[1],
    obreb: padObreb(m[2]),
    arkusz: arkusz(m[3]),
    dzialka: m[4],
    budynek: m[5],
    lokal: m[6],
  };
}

/** Subject identity: building id first (GEOPOZ ID_BUDYNKU), parcel id as fallback (ULDK). */
export function deriveSubjectEgib(
  buildingId: string | null | undefined,
  parcelId: string | null | undefined,
): SubjectEgib | undefined {
  const b = buildingId ? BUILDING_ID_RX.exec(buildingId.trim()) : null;
  if (b) return { obreb: padObreb(b[2]), arkusz: arkusz(b[3]), dzialka: b[4], budynek: b[5] };
  const p = parcelId ? PARCEL_ID_RX.exec(parcelId.trim()) : null;
  if (p) return { obreb: padObreb(p[2]), arkusz: arkusz(p[3]), dzialka: p[4] };
  return undefined;
}
