"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { mapImages } from "@/app/valuations/_deps";
import { recordFailure } from "@/app/actions/_record-failure";
import { withTrace } from "@/lib/trace";
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
  // Pinned to a local: `mapImages` is a mutable module export, so the null
  // check above does not narrow it inside the async closure below.
  const maps = mapImages;
  // Traced like every other worker-calling action. This one was missed in the
  // observability slice and it is the worst one to miss: the Geoportal/WMS
  // path is the least reliable the app has, so without a shared id its
  // failures were precisely the ones impossible to line up across the two
  // services.
  return withTrace(async () => {
    try {
      const result = await maps.fetchMaps(parsed.data.address);
      if (result.kind !== "ok") {
        return { unavailable: result.message };
      }
      return {
        ewidencyjna: result.maps.ewidencyjna.toString("base64"),
        orto: result.maps.orto.toString("base64"),
      };
    } catch (error) {
      await recordFailure({ event: "getMapPreview.failed", error, actorId: session.user.id });
      // The message stays as it was — a preview that cannot be drawn is not
      // an error the appraiser must act on, so it gets no code.
      return { unavailable: "Nie udało się pobrać podglądu map." };
    }
  });
}
