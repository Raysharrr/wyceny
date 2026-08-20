/**
 * Port for the worker's address-suggestion lookup: street/address candidates
 * from the UUG geocoder feeding the step-1 address combobox.
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
  /** MVP coverage gate (TERYT 3064*) — lets the UI flag out-of-coverage hits. */
  inCoverage: boolean;
}

export interface PortAddressSuggest {
  /**
   * Suggestions for a partial user-typed address. Total — implementations
   * never throw: suggestions are an enhancement, so every failure (timeout,
   * 5xx, malformed body) is an empty list, never a form error.
   */
  suggest(query: string): Promise<AddressSuggestion[]>;
}
