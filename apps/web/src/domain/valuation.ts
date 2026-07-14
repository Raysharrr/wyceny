import { approvalGate, type Blocker } from "./provenance";
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
    wr: input.wr,
    inputs: input.inputs,
    amountInWords: input.amountInWords,
    docUrl: input.docUrl,
    ownerId: input.ownerId,
    status: "in_progress",
    approvedAt: null,
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

export class ApprovalBlockedError extends Error {
  constructor(public readonly blockers: Blocker[]) {
    super(`Approval blocked by F-4 gate: ${blockers.map((b) => b.path).join(", ")}`);
    this.name = "ApprovalBlockedError";
  }
}

function assertDraft(v: Valuation): void {
  if (v.status !== "in_progress") {
    throw new Error(`Valuation ${v.id} is not a draft (status: ${v.status}) — mutation refused`);
  }
}

/**
 * The bulk-confirm mutation (spec §5): flips rcn comparables and the geocode
 * entry from to_verify to confirmed. The ONLY content mutation a draft
 * allows besides approval. Pure — the adapter persists the result.
 */
export function confirmSampleProvenance(v: Valuation): Valuation {
  assertDraft(v);
  if (!v.inputs) {
    throw new Error(`Valuation ${v.id} has no inputs snapshot — nothing to confirm`);
  }
  const comparables = v.inputs.comparables.map((c) =>
    c.source === "rcn" && c.status === "to_verify" ? { ...c, status: "confirmed" as const } : c,
  );
  const provenance = v.inputs.provenance?.geocode
    ? {
        ...v.inputs.provenance,
        geocode: { ...v.inputs.provenance.geocode, status: "confirmed" as const },
      }
    : v.inputs.provenance;
  return { ...v, inputs: { ...v.inputs, comparables, provenance } };
}

/**
 * The approve mutation — F-4 gate as aggregate invariant (ADR-012). A draft
 * without a snapshot can never pass (default-deny).
 */
export function approveValuation(v: Valuation, now: Date): Valuation {
  assertDraft(v);
  if (!v.inputs) {
    throw new ApprovalBlockedError([{ path: "inputs", label: "Brak danych wejściowych operatu." }]);
  }
  const gate = approvalGate(v.inputs);
  if (!gate.ok) {
    throw new ApprovalBlockedError(gate.blockers);
  }
  return { ...v, status: "approved", approvedAt: now };
}
