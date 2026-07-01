import type { NewWycenaInput, Wycena } from "../ports/wyceny";

/**
 * Pure Wycena domain logic.
 *
 * ZERO imports of drizzle/pg/db/client — this is the F-10 dependency-rule
 * boundary (only type-level imports from the pure `ports/` contracts are
 * allowed). Persistence lives entirely in `adapters/wyceny-drizzle.ts`.
 */

/**
 * Builds the to-insert shape for a new Wycena. Every new Wycena starts in
 * `"w_toku"` — `id` and `createdAt` are assigned by the database on insert.
 */
export function newWycena(input: NewWycenaInput): Omit<Wycena, "id" | "createdAt"> {
  return {
    address: input.address,
    area: input.area,
    stubWr: input.stubWr,
    slownie: input.slownie,
    docUrl: input.docUrl,
    ownerId: input.ownerId,
    status: "w_toku",
  };
}

/**
 * Write-once invariant (F-7): a `podpisany` Wycena can never be mutated.
 * Throws if the given Wycena is already signed.
 */
export function assertNotSigned(w: Wycena): void {
  if (w.status === "podpisany") {
    throw new Error(`Wycena ${w.id} is already podpisany (signed) — write-once, cannot be modified`);
  }
}
