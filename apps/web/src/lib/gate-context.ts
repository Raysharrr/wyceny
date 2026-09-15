import { currentSectionFactsHashes } from "@/domain/prose-hash";
import type { GateOptions } from "@/domain/provenance";
import type { AppraiserProfile } from "@/ports/profile";
import type { Valuation } from "@/ports/valuation";
import { proseEnabled } from "@/lib/prose-enabled";

/**
 * The app-layer half of the approval gate (R-1): what `approvalBlockers` needs
 * but `domain/` may not compute itself — the FR-6 kill switch (env), the
 * per-section facts hashes (`node:crypto`), the appraiser's profile (a db
 * read) and the clock. Server-only for the same reasons.
 *
 * Step 7, the flat view and the approve action all build the gate from here,
 * so the list on the screen names exactly what the action refuses on. The
 * repository's `approve` still derives both prose values again inside its own
 * transaction (ADR-012) — that read is authoritative, this one is the
 * fail-fast and the screen.
 *
 * `author` is REQUIRED rather than optional, and that is the whole enforcement
 * of B-15/B-16. The domain skips the profile group when the context does not
 * carry one — it cannot invent a blocker out of "the caller does not know" —
 * so the guarantee that no real call site forgets to read the profile has to
 * live in this signature. `null` is a valid answer meaning "no profile row at
 * all", and it raises both blockers.
 */
export function gateContextFor(
  valuation: Pick<Valuation, "address" | "inputs">,
  author: AppraiserProfile | null,
  /** The date the operat would carry; today for the screens, `now` at approval. */
  today: Date = new Date(),
): GateOptions {
  const requireProse = proseEnabled();
  return {
    requireProse,
    author,
    today,
    // Lets the gate see the sections whose facts have since moved on (T6
    // review, I-2; per section since T4). Derived here, never taken from the
    // client.
    currentSectionHashes:
      requireProse && valuation.inputs
        ? currentSectionFactsHashes({ address: valuation.address, inputs: valuation.inputs })
        : undefined,
  };
}
