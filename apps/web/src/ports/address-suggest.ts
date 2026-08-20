/**
 * Port for the worker's address-suggestion lookup: street/address candidates
 * from the UUG geocoder feeding the step-1 address combobox. The worker already
 * filters them to the app's coverage (`COVERAGE_TERYT_PREFIX` in the worker), so
 * the UI has no coverage flag to render — every suggestion is inside the area the
 * app's subject-data sources attempt to serve.
 *
 * Pure interface — no imports, no I/O. Application code depends on this
 * abstraction, never on a concrete adapter (F-10).
 */
export interface AddressSuggestion {
  /** Canonical display/insert form: "Miasto, Ulica" or "Miasto, Ulica Nr". */
  label: string;
  city: string;
  street: string;
  /** Present only for exact-address results (UUG "only exact numbers"). */
  number: string | null;
  teryt: string | null;
}

export interface PortAddressSuggest {
  /**
   * Suggestions for a partial user-typed address. Total — implementations
   * never throw: suggestions are an enhancement, so every failure (timeout,
   * 5xx, malformed body) is an empty list, never a form error.
   */
  suggest(query: string): Promise<AddressSuggestion[]>;
}
