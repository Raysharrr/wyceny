import type {
  PoolPoint,
  CandidatePool,
  PortSampleProposal,
  SamplePoolRequest,
} from "../ports/sample";
import type { CoopTransaction, PortCoopRegistry } from "../ports/coop-registry";
import { coopBuildingRef } from "../domain/coop-import";
import { DEFAULTS, type Candidate } from "../domain/sample-selection";

/** What the subject geocoder hands back — a point on EPSG:2180 and which link of the chain found it. */
export type SubjectGeocode = (
  address: string,
) => Promise<Omit<PoolPoint, "source"> & { source: "uug" | "nominatim" }>;

/**
 * Second adapter for {@link PortSampleProposal} (T-14, S3 of the "Prawo
 * spółdzielcze" block): the office's own coop register instead of the
 * worker's RCN WFS. The domain (`selectSample`) sees the same `CandidatePool`
 * shape — every difference lives in how the fields are filled:
 *
 * - `distanceM` is PLANAR on EPSG:2180 (`hypot(dx, dy)`), the same metric the
 *   register's SQL radius filter uses, so the radius walk and the ranking
 *   never disagree on a distance. Not `domain/geo.ts#distanceM` (WGS 84).
 * - `egib: null` — a register row has no EGiB identity; rule 6 (max 3 per
 *   building) runs on `buildingRef` (`coopBuildingRef`, B3).
 * - `function`/`transType`/`market`/`share`/`seller`: null — the register has
 *   no such columns; hygiene skips those rules and flags the row (ADR-010).
 * - `rightType` is carried as the register states it, `null` when unknown
 *   (→ flag `prawo_nieznane` in the domain).
 * - `pos === null` rows are filtered by the port; counted under `noPos` here
 *   defensively, never proposed.
 * - A `truncated` register read (5 000-row ceiling) is REFUSED, never turned
 *   into a silent, incomplete pool.
 */
export function coopRegistrySampleProposal(
  registry: PortCoopRegistry,
  geocodeSubject: SubjectGeocode,
): PortSampleProposal {
  return {
    async fetchPool(input: SamplePoolRequest): Promise<CandidatePool> {
      const point: PoolPoint = input.point
        ? { x: input.point.x, y: input.point.y, source: "subject" }
        : await geocodeSubject(input.address);
      const maxRadiusM = input.radiusM ?? Math.max(...DEFAULTS.radiusStepsM);
      const { rows, truncated } = await registry.list({
        near: { x: point.x, y: point.y, radiusM: maxRadiusM },
      });
      if (truncated) {
        throw new Error(
          `Rejestr biura ma w promieniu ${maxRadiusM} m więcej transakcji, niż da się pobrać naraz — pula byłaby niekompletna. Zawęź rejestr albo zgłoś to administratorowi.`,
        );
      }
      const withPos = rows.filter(
        (r): r is CoopTransaction & { pos: { x: number; y: number } } => r.pos !== null,
      );
      const stats = await registry.stats();
      return {
        point,
        maxRadiusM,
        candidates: withPos.map((r) => toCandidate(r, point)),
        counts: {
          fetched: rows.length,
          deduped: withPos.length,
          noPos: rows.length - withPos.length,
        },
        fetchedAt: new Date().toISOString(),
        source: "rejestr-sm",
        importedAt: stats.lastImport?.at ?? null,
        // No WFS behind this pool — the query block records the radius search only.
        query: { bbox: [], count: rows.length, sort: "date desc", pages: 1, truncated: false },
      };
    },
  };
}

function toCandidate(
  r: CoopTransaction & { pos: { x: number; y: number } },
  point: { x: number; y: number },
): Candidate {
  return {
    // The register row id is the candidate key (`candidateKey` = transactionId|lokalId) AND
    // travels on the comparable as `coopTxId` — the unforgeable "this came from the register"
    // signal for `assign-provenance.ts`. One lokal per row, so lokalId stays empty.
    transactionId: r.id,
    lokalId: "",
    date: r.date,
    area: r.area,
    pricePerM2: r.pricePerM2,
    priceTotal: r.priceTotal,
    egib: null,
    buildingRef: coopBuildingRef(r),
    distanceM: Math.hypot(r.pos.x - point.x, r.pos.y - point.y),
    floor: r.floor,
    rooms: r.rooms,
    market: null,
    share: null,
    transType: null,
    function: null,
    seller: null,
    pos: r.pos,
    street: r.address,
    streetNumber: r.buildingNumber,
    city: null,
    rightType: r.rightType,
    cooperative: r.cooperative,
  };
}
