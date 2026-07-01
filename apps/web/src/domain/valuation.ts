import type { NewValuationInput, Valuation } from "../ports/valuation";

/**
 * Pure Valuation domain logic.
 *
 * ZERO imports of drizzle/pg/db/client — this is the F-10 dependency-rule
 * boundary (only type-level imports from the pure `ports/` contracts are
 * allowed). Persistence lives entirely in `adapters/valuation-drizzle.ts`.
 */

/**
 * Builds the to-insert shape for a new Valuation. Every new Valuation starts
 * in `"in_progress"` — `id` and `createdAt` are assigned by the database on
 * insert.
 */
export function newValuation(input: NewValuationInput): Omit<Valuation, "id" | "createdAt"> {
  return {
    address: input.address,
    area: input.area,
    stubWr: input.stubWr,
    amountInWords: input.amountInWords,
    docUrl: input.docUrl,
    ownerId: input.ownerId,
    status: "in_progress",
  };
}

/**
 * Write-once invariant (F-7): a `signed` Valuation can never be mutated.
 * Throws if the given Valuation is already signed.
 */
export function assertNotSigned(w: Valuation): void {
  if (w.status === "signed") {
    throw new Error(`Valuation ${w.id} is already signed — write-once, cannot be modified`);
  }
}
