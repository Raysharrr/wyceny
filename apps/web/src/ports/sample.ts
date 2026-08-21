/**
 * Port for the worker's RCN sample pool (comparable transactions used to
 * seed the "porownawcze" approach for a valuation, ADR-015 "Dobor proby v3").
 *
 * `Candidate` is a domain type (`domain/sample-selection.ts`) re-exported
 * here type-only — the pool this port fetches is exactly the raw candidate
 * list `selectSample` (pure domain logic) then ranks/filters client-side.
 *
 * Pure interface — no runtime imports, no I/O. Application code depends on
 * this abstraction, never on a concrete adapter (F-10).
 */
import type { Candidate } from "../domain/sample-selection";

export type { Candidate };

export type PoolPoint = { x: number; y: number; source: "subject" | "uug" | "nominatim" };

export type CandidatePool = {
  point: PoolPoint;
  maxRadiusM: number;
  candidates: Candidate[];
  counts: { fetched: number; deduped: number; noPos: number };
  fetchedAt: string;
  source: "rcn-wfs-gugik";
  query: { bbox: number[]; count: number; sort: string; pages: number; truncated: boolean };
};

export type SamplePoolRequest = {
  address: string;
  area: number;
  point?: { x: number; y: number; srid: 2180 };
  radiusM?: number;
};

export interface PortSampleProposal {
  /**
   * Fetches the raw candidate pool for the given address/area (and,
   * optionally, an already-resolved subject point/radius), sourced from the
   * RCN (rejestr cen nieruchomosci) via the worker's WFS integration.
   */
  fetchPool(input: SamplePoolRequest): Promise<CandidatePool>;
}
