"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSession } from "@/auth/session";
import { coopRegistry, geocoder } from "@/app/valuations/_deps";
import { recordEvent, recordFailure } from "@/app/actions/_record-failure";
import { PROPERTY_RIGHTS } from "@/domain/property-right";
import { mintWorkerToken } from "@/lib/worker-token";
import { withTrace } from "@/lib/trace";
import { PRICE_KINDS } from "@/ports/coop-registry";

/**
 * `/rejestr/transakcja` (T-13, S2b Task 6): one manual row. Geocodes the
 * address first (worker chain, degrades to null), then `save()` — which
 * returns a typed result instead of throwing. Both failure branches are
 * Polish and carry NO address or flat number (F-13: the adapter already
 * swallows Postgres' DETAIL; this layer never re-adds it).
 */
const DUPLICATE_MSG =
  "Taka transakcja jest już w rejestrze (ten sam adres, mieszkanie i data albo ten sam numer repertorium).";
const INVALID_MSG = "Powierzchnia i cena muszą być większe od zera.";
const NOT_CONFIGURED = "Zapis nie jest skonfigurowany — skontaktuj się z administratorem.";
const GENERIC = "Nie udało się zapisać transakcji — spróbuj ponownie.";

const optInt = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : v),
  z.coerce.number().int().nullable(),
);

const inputSchema = z.object({
  cooperative: z.string().trim().min(1, "Wskaż spółdzielnię.").max(200),
  city: z.string().trim().min(1, "Wpisz miasto.").max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Podaj datę transakcji."),
  address: z.string().trim().min(1, "Podaj adres.").max(300),
  buildingNumber: z.string().trim().min(1, "Podaj numer budynku.").max(50),
  flatNumber: z.string().trim().min(1, "Podaj numer mieszkania.").max(50),
  area: z.coerce.number({ message: INVALID_MSG }).positive(INVALID_MSG),
  priceTotal: z.coerce.number({ message: INVALID_MSG }).positive(INVALID_MSG),
  priceKind: z.enum(PRICE_KINDS),
  rightType: z.enum(PROPERTY_RIGHTS).nullable(),
  floor: optInt,
  rooms: optInt,
  buildYear: optInt,
  rep: z.string().trim().max(100).nullable(),
});
export type SaveCoopTransactionInput = z.input<typeof inputSchema>;

export type SaveCoopTransactionResult =
  | { ok: true; id: string; needsFix: boolean }
  | { ok: false; error: string; field?: keyof SaveCoopTransactionInput };

export async function saveCoopTransaction(
  input: SaveCoopTransactionInput,
): Promise<SaveCoopTransactionResult> {
  const session = await getSession();
  if (!session) redirect("/login");
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return {
      ok: false,
      error: issue.message,
      field: issue.path[0] as keyof SaveCoopTransactionInput,
    };
  }
  const token = mintWorkerToken();
  if (!token) return { ok: false, error: NOT_CONFIGURED };
  const { city, ...row } = parsed.data;
  return withTrace(async () => {
    try {
      const [hit] = await geocoder.geocodeMany(
        [`${city}, ${row.address} ${row.buildingNumber}`],
        token,
      );
      const saved = await coopRegistry.save(
        { ...row, pos: hit ? { x: hit.x, y: hit.y } : null, source: "manual" },
        { userId: session.user.id },
      );
      if (!saved.ok) {
        return saved.reason === "duplicate"
          ? { ok: false, error: DUPLICATE_MSG }
          : { ok: false, error: INVALID_MSG, field: "area" };
      }
      await recordEvent({
        level: hit ? "info" : "warn",
        event: "coop.manual.saved",
        actorId: session.user.id,
        meta: { geocoded: hit ? 1 : 0 },
      });
      revalidatePath("/rejestr");
      return { ok: true, id: saved.row.id, needsFix: !hit };
    } catch (err) {
      await recordFailure({ event: "coop.manual.failed", error: err, actorId: session.user.id });
      return { ok: false, error: GENERIC };
    }
  });
}
