"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { mapImages } from "@/app/valuations/_deps";
import { valuationFormObject } from "@/lib/valuation-form-schema";

const inputSchema = valuationFormObject.pick({ address: true });

export type GetMapPreviewResult = { ewidencyjna: string; orto: string } | { unavailable: string };

/**
 * Server Action backing the §8.1 map preview (Slice 9). Live, NOT persisted —
 * the frozen copy is fetched independently at approve (spec decision 1).
 */
export async function getMapPreview(input: { address: string }): Promise<GetMapPreviewResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { unavailable: "Nieprawidłowy adres." };
  }
  if (!mapImages) {
    return { unavailable: "Podgląd map jest wyłączony." };
  }
  const result = await mapImages.fetchMaps(parsed.data.address);
  if (result.kind !== "ok") {
    return { unavailable: result.message };
  }
  return {
    ewidencyjna: result.maps.ewidencyjna.toString("base64"),
    orto: result.maps.orto.toString("base64"),
  };
}
