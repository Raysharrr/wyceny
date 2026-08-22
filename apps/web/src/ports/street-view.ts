/** Port for the building-facade preview (Slice 3). Pure interface — no imports (F-10). */
export type PanoramaMeta = {
  panoId: string;
  captureDate: string | null;
  camera: { lat: number; lng: number };
};
export interface PortStreetView {
  /** Metadata API: nearest outdoor panorama within `radiusM`; null when Google has none (ZERO_RESULTS). Throws on transport/auth errors. */
  lookup(at: { lat: number; lng: number }, radiusM: number): Promise<PanoramaMeta | null>;
  /** Static API 160×100 JPEG for a panorama, camera at `view` (heading/pitch/fov — `domain/street-view-framing.ts`). */
  thumbnail(panoId: string, view: { heading: number; pitch: number; fov: number }): Promise<Buffer>;
}
