"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { storage, worker, valuationRepository } from "@/app/valuations/_deps";

export type CreateValuationInput = {
  address: string;
  area: number;
};

export type CreateValuationResult = { error: string } | undefined;

/**
 * Server Action backing `valuations/new` (Task 9 — the E2E climax). Crosses
 * every boundary built so far: session (T6) → PortWorker over HTTP (T4) →
 * PortStorage (T8) → PortValuation/Postgres (T5), with ownership isolation
 * (T7) applied on every later read.
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

  const address = input.address?.trim() ?? "";
  const area = Number(input.area);

  if (!address) {
    return { error: "Podaj adres nieruchomości." };
  }
  if (!Number.isFinite(area) || area <= 0) {
    return { error: "Powierzchnia musi być większa od zera." };
  }

  // STUB: replaced by the real KCS engine in the next slice
  const stubWr = Math.max(1, Math.round(area)) * 10000;

  let amountInWords: string;
  let docUrl: string;
  try {
    amountInWords = await worker.amountInWords(stubWr);
    const doc = `Operat (stub)\nAdres: ${address}\nPowierzchnia: ${area} m²\nWR: ${stubWr}\nSłownie: ${amountInWords}`;
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
    stubWr,
    amountInWords,
    docUrl,
    ownerId: session.user.id,
  });

  redirect(`/valuations/${created.id}`);
}
