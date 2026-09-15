import { currentSectionFactsHashes } from "@/domain/prose-hash";
import type { GateOptions } from "@/domain/provenance";
import type { Valuation } from "@/ports/valuation";
import { proseEnabled } from "@/lib/prose-enabled";

/**
 * The app-layer half of the approval gate (R-1): what `approvalBlockers` needs
 * but `domain/` may not compute itself — the FR-6 kill switch (env) and the
 * per-section facts hashes (`node:crypto`). Server-only for the same reason.
 *
 * Step 7, the flat view and the approve action all build the gate from here,
 * so the list on the screen names exactly what the action refuses on. The
 * repository's `approve` still derives both values again inside its own
 * transaction (ADR-012) — that read is authoritative, this one is the
 * fail-fast and the screen.
 */
export function gateContextFor(valuation: Pick<Valuation, "address" | "inputs">): GateOptions {
  const requireProse = proseEnabled();
  return {
    requireProse,
    // Lets the gate see the sections whose facts have since moved on (T6
    // review, I-2; per section since T4). Derived here, never taken from the
    // client.
    currentSectionHashes:
      requireProse && valuation.inputs
        ? currentSectionFactsHashes({ address: valuation.address, inputs: valuation.inputs })
        : undefined,
  };
}
