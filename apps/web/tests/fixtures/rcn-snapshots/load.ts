import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dedupe, type Candidate } from "../../../src/domain/sample-selection";
import { parseLokalId } from "../../../src/domain/egib-id";

/** Shape written by the spike (tools/spike/2026-08-20-dobor-proby-v3/spike.ts). */
export type SnapshotSubject = {
  address: string;
  x: number;
  y: number;
  teryt: string;
  parcelId: string | null;
  buildingId: string | null;
  buildingIds: string[];
};
type RawRecord = Candidate & { versionId: string; page: number };
type Snapshot = {
  subject: SnapshotSubject;
  fetchedAt: string;
  pages: { returned: number }[];
  rawRecords: RawRecord[];
};

export function loadSnapshot(slug: string) {
  const path = fileURLToPath(new URL(`./${slug}-candidates.json.gz`, import.meta.url));
  const snap = JSON.parse(gunzipSync(readFileSync(path)).toString("utf8")) as Snapshot;
  const { kept, dropped } = dedupe(snap.rawRecords);
  // Re-derive egib with the web parser — the fixture exercises it on tens of thousands of real ids.
  const candidates: Candidate[] = kept.map(({ versionId: _v, page: _p, ...c }) => ({
    ...c,
    egib: parseLokalId(c.lokalId),
  }));
  return {
    subject: snap.subject,
    candidates,
    pages: snap.pages.length,
    fetched: snap.rawRecords.length,
    deduped: dropped,
  };
}
