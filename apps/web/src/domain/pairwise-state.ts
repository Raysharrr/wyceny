import {
  resolveMethod,
  ValuationCalculationError,
  type Comparable,
  type ValuationInput,
} from "./valuation-input";

/** T-06–T-09: single count policy, consumed by readiness and PP selection. */
export const VALUATION_SAMPLE_LIMITS = { kcs: { min: 12 }, pp: { min: 3, max: 5 } } as const;
const present = (value: string | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;

/** ACL assigns missing row ids; this pure resolver never invents identity from position/price. */
export function comparableIdentity(row: Comparable): string | null {
  const encode = encodeURIComponent;
  if (row.source === "rcn") {
    if (present(row.transactionId) && present(row.lokalId))
      return `rcn:${encode(row.transactionId)}|${encode(row.lokalId)}`;
    return present(row.id) ? `rcn:row:${encode(row.id)}` : null;
  }
  if (row.source === "rejestr_sm") {
    if (present(row.coopTxId)) return `sm:${encode(row.coopTxId)}`;
    return present(row.id) ? `sm:row:${encode(row.id)}` : null;
  }
  if (row.source !== undefined && row.source !== "manual") return null;
  return present(row.id) ? `manual:${encode(row.id)}` : null;
}

/** Exactly the selected PP rows, in column order; KCS retains its historical full sample. */
export function valuationComparables(input: ValuationInput): Comparable[] {
  if (resolveMethod(input) === "kcs") return input.comparables;
  const ids = input.pairwise?.selectedComparableIds ?? [];
  const issues = [];
  if (ids.length < VALUATION_SAMPLE_LIMITS.pp.min || ids.length > VALUATION_SAMPLE_LIMITS.pp.max) {
    issues.push({
      path: "comparables",
      label: "Do porównywania parami wybierz od 3 do 5 transakcji.",
    });
  }
  const rows = new Map<string, Comparable>();
  input.comparables.forEach((row, i) => {
    const id = comparableIdentity(row);
    if (!id || rows.has(id)) {
      issues.push({
        path: `comparables.${i}.id`,
        label: "Transakcje muszą mieć trwałe, unikalne identyfikatory.",
      });
    } else rows.set(id, row);
  });
  const selected = new Set<string>();
  ids.forEach((id, i) => {
    if (selected.has(id) || !rows.has(id)) {
      issues.push({
        path: `pairwise.selectedComparableIds.${i}`,
        label: "Wybrana transakcja nie istnieje albo została wybrana dwukrotnie.",
      });
    }
    selected.add(id);
  });
  if (issues.length) throw new ValuationCalculationError(issues);
  return ids.map((id) => rows.get(id)!);
}

/** Sort map keys only. Arrays preserve feature/column order; omit absent optional fields. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, v]) => [key, canonical(v)]),
    );
  }
  // Do not let JSON conflate an invalid draft value with an explicit null cell.
  if (typeof value === "number" && !Number.isFinite(value)) return { invalidNumber: String(value) };
  return value;
}

/**
 * AC06: opaque deterministic basis, NOT a client permission token. Works on incomplete
 * drafts too. Compare the ORIGINAL loaded basis under a lock, then stamp the edited
 * basis. All cells (including unused ones) participate; only marker/statuses are omitted.
 */
export function pairwiseBasis(input: ValuationInput): string {
  const ids = input.pairwise?.selectedComparableIds ?? [];
  const rows = ids.map((id) => ({
    selectedId: id,
    // Keep missing/duplicate matches visible in the basis instead of picking one silently.
    matches: input.comparables
      .filter((row) => comparableIdentity(row) === id)
      .map((row) => ({
        id: row.id,
        source: row.source,
        transactionId: row.transactionId,
        lokalId: row.lokalId,
        coopTxId: row.coopTxId,
        date: row.date,
        area: row.area,
        pricePerM2: row.pricePerM2,
      })),
  }));
  return JSON.stringify(
    canonical({
      method: resolveMethod(input),
      area: input.area,
      selectedComparableIds: ids,
      comparables: rows,
      features: input.features.map((f) => ({
        key: f.key,
        name: f.name,
        weight: f.weight,
        rating: f.rating,
        ratingScale: f.ratingScale ?? "three",
        definitions: f.definitions,
      })),
      comparisons: input.pairwise?.comparisons ?? {},
    }),
  );
}
