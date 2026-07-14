"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { storage, worker, valuationRepository } from "@/app/valuations/_deps";
import { valuationFormSchema, type ValuationFormValues } from "@/lib/valuation-form-schema";
import { computeKcs, type KcsInput } from "@/domain/kcs";
import { assignProvenance } from "@/lib/assign-provenance";

export type CreateValuationInput = ValuationFormValues;

export type CreateValuationResult = { error: string } | undefined;

/**
 * Server Action backing `valuations/new` (Task 9 — the E2E climax). Crosses
 * every boundary built so far: session (T6) → PortWorker over HTTP (T4) →
 * PortStorage (T8) → PortValuation/Postgres (T5), with ownership isolation
 * (T7) applied on every later read. KCS Task 4 makes the engine live: the
 * shared schema is the authoritative re-check (same rules as the client
 * resolver, Task 3), and `computeKcs` now computes the WR.
 *
 * Returns `{ error }` for recoverable failures (bad input, worker/storage
 * down) so the client form can show a Polish message. On success it never
 * returns — `redirect()` throws, which must propagate uncaught.
 */
export async function createValuation(input: CreateValuationInput): Promise<CreateValuationResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  // Authoritative validation — same schema as the client resolver.
  const parsed = valuationFormSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    // zod v4's built-in `invalid_type` message is English ("Invalid input:
    // expected string, received number") — only reachable for structurally
    // malformed payloads that bypass the client (adversarial input, since
    // the client's resolver already runs this same schema). All other
    // issues carry our own Polish messages (see valuation-form-schema.ts)
    // and must pass through unchanged.
    const message =
      firstIssue?.code === "invalid_type" ? "Nieprawidłowe dane formularza." : firstIssue?.message;
    return { error: message ?? "Nieprawidłowe dane formularza." };
  }
  const { address, area, features, sampleMeta } = parsed.data;

  // Assign provenance statuses server-side: rcn rows get to_verify, manual
  // rows get confirmed. This is the ACL of ADR-010 — statuses are born here,
  // server-side only, never trusted from the client. % → fractions at the
  // action boundary; the engine works in fractions. `sampleMeta` is normalized
  // to `null` when absent so every stored snapshot has the same shape
  // (manual-only submissions vs. RCN-seeded ones).
  const { comparables: sourcedComparables, provenance } = assignProvenance(parsed.data);
  const kcsInput: KcsInput = {
    area,
    comparables: sourcedComparables,
    features: features.map((f) => ({ name: f.name, weight: f.weightPct / 100, rating: f.rating })),
    sampleMeta: sampleMeta ?? null,
    provenance,
  };
  const { wr } = computeKcs(kcsInput);

  let amountInWords: string;
  let docUrl: string;
  try {
    amountInWords = await worker.amountInWords(wr);
    const doc = `Operat\nAdres: ${address}\nPowierzchnia: ${area} m²\nWR: ${wr}\nSłownie: ${amountInWords}`;
    docUrl = await storage.put(randomUUID(), doc);
  } catch (error) {
    console.error("createValuation: worker/storage failure", error);
    return {
      error:
        "Nie udało się przygotować operatu — worker lub magazyn dokumentów są niedostępne. Spróbuj ponownie.",
    };
  }

  const created = await valuationRepository.create({
    address,
    area,
    wr,
    inputs: kcsInput,
    amountInWords,
    docUrl,
    ownerId: session.user.id,
  });

  redirect(`/valuations/${created.id}`);
}
