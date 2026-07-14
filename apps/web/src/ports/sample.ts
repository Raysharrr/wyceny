/**
 * Port for the worker's RCN sample proposal (comparable transactions used
 * to seed the "porownawcze" approach for a valuation).
 *
 * Pure interface — no imports, no I/O. Application code depends on this
 * abstraction, never on a concrete adapter (F-10).
 */
export interface SampleTransaction {
  date: string;
  area: number;
  pricePerM2: number;
  transactionId: string;
}

export interface SampleMeta {
  lat: number;
  lon: number;
  fetchedAt: string;
  source: string;
  query: {
    bbox: number[];
    count: number;
    sort: string;
  };
}

export interface SampleProposal {
  transactions: SampleTransaction[];
  meta: SampleMeta;
}

export interface PortSampleProposal {
  /**
   * Fetches a proposed comparable-transaction sample for the given address
   * and area, sourced from the RCN (rejestr cen nieruchomosci) via the
   * worker's WFS integration.
   */
  fetchProposal(address: string, area: number): Promise<SampleProposal>;
}
