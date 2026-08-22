/**
 * EPSG:2180 (PUWG 1992) ↔ WGS84 without a dependency. PUWG 1992 = Transverse
 * Mercator on GRS80: lon0 = 19°E, k0 = 0.9993, FE = 500 000, FN = −5 300 000.
 * Inverse via the Krüger series (3 terms — sub-millimetre over Poland).
 * Input axis order follows the worker's normalised `pos`: x = easting, y = northing.
 */
const A_ = 6378137.0;
const F_ = 1 / 298.257222101;
const K0 = 0.9993;
const LON0 = (19 * Math.PI) / 180;
const FE = 500_000;
const FN = -5_300_000;
const N_ = F_ / (2 - F_);
const A_RECT = (A_ / (1 + N_)) * (1 + (N_ * N_) / 4 + N_ ** 4 / 64);
const BETA = [
  N_ / 2 - (2 * N_ * N_) / 3 + (37 * N_ ** 3) / 96,
  (N_ * N_) / 48 + N_ ** 3 / 15,
  (17 * N_ ** 3) / 480,
];
const DELTA = [
  2 * N_ - (2 * N_ * N_) / 3 - 2 * N_ ** 3,
  (7 * N_ * N_) / 3 - (8 * N_ ** 3) / 5,
  (56 * N_ ** 3) / 15,
];

export function puwg92ToWgs84(x: number, y: number): { lat: number; lng: number } {
  const xi = (y - FN) / (K0 * A_RECT);
  const eta = (x - FE) / (K0 * A_RECT);
  let xi2 = xi;
  let eta2 = eta;
  for (let j = 0; j < 3; j++) {
    const k = 2 * (j + 1);
    xi2 -= BETA[j] * Math.sin(k * xi) * Math.cosh(k * eta);
    eta2 -= BETA[j] * Math.cos(k * xi) * Math.sinh(k * eta);
  }
  const chi = Math.asin(Math.sin(xi2) / Math.cosh(eta2));
  let phi = chi;
  for (let j = 0; j < 3; j++) phi += DELTA[j] * Math.sin(2 * (j + 1) * chi);
  const lam = Math.atan2(Math.sinh(eta2), Math.cos(xi2));
  return { lat: (phi * 180) / Math.PI, lng: ((lam + LON0) * 180) / Math.PI };
}

/** Initial bearing from → to, degrees clockwise from north (what Street View's `heading` expects). */
export function bearingDeg(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLng = toRad(to.lng - from.lng);
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const yy = Math.sin(dLng) * Math.cos(lat2);
  const xx = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(yy, xx) * 180) / Math.PI + 360) % 360;
}

/** Equirectangular approximation, metres — fine at building scale (well under a km); not for long-range distances. */
export function distanceM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const mPerDegLat = 111_320;
  const dLat = (b.lat - a.lat) * mPerDegLat;
  const dLng = (b.lng - a.lng) * mPerDegLat * Math.cos(toRad((a.lat + b.lat) / 2));
  return Math.hypot(dLat, dLng);
}

/**
 * Square map frame around `center` (EPSG:2180): the WMS bbox (1.3.0 axis
 * order for EPSG:2180 — northing first, as apps/worker/app/maps.py) and a
 * metre→pixel mapping that is exactly linear because 2180 is a projected CRS.
 */
export function mapFrame(center: { x: number; y: number }, halfM: number, px: number) {
  const mPerPx = (2 * halfM) / px;
  const bbox: [number, number, number, number] = [
    center.y - halfM,
    center.x - halfM,
    center.y + halfM,
    center.x + halfM,
  ];
  return {
    bbox,
    mPerPx,
    toPx(pos: { x: number; y: number }) {
      return { px: (pos.x - (center.x - halfM)) / mPerPx, py: (center.y + halfM - pos.y) / mPerPx };
    },
  };
}
