"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getSession } from "@/auth/session";
import { coopRegistry, coopSheet, eventLog, geocoder } from "@/app/valuations/_deps";
import { recordFailure } from "@/app/actions/_record-failure";
import { COOP_FIELDS, coopDedupeKey, type ColumnMapping } from "@/domain/coop-import";
import { PROPERTY_RIGHTS } from "@/domain/property-right";
import {
  finalizeCoopImport,
  importCoopChunk,
  startCoopImport,
  type CoopImportSummary,
} from "@/lib/coop-import-service";
import { IMPORT_CHUNK, type CoopChunkResult } from "@/lib/coop-import-chunks";
import { mintWorkerToken } from "@/lib/worker-token";
import { currentTraceId, withTrace } from "@/lib/trace";
import { PRICE_KINDS, type NewCoopTransaction } from "@/ports/coop-registry";
import type { CoopSheet } from "@/ports/coop-sheet";

/**
 * Server Actions behind `/rejestr/import` (T-13, S2b Tasks 3–5). The screen
 * reads the sheet here, parses it in the browser (`parseCoopSheet` is pure),
 * then drives the import in slices of {@link CHUNK} rows: start → chunk… →
 * finalize (see `lib/coop-import-service`). Every action is session-gated;
 * rows coming back from the browser are re-validated and re-keyed here —
 * the dedupe key is never trusted from the client.
 */
const NOT_CONFIGURED = "Import nie jest skonfigurowany — skontaktuj się z administratorem.";

type Ok<T> = T & { error?: undefined };
type Fail = { error: string };

async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function readCoopSheet(
  formData: FormData,
): Promise<Ok<{ sheets: CoopSheet[] }> | Fail> {
  const session = await requireSession();
  const file = formData.get("file");
  // Duck-typed: the runtime's File class may differ from the global one across the RSC boundary.
  if (!file || typeof file === "string" || file.size === 0)
    return { error: "Wybierz plik XLS lub XLSX." };
  const token = mintWorkerToken();
  if (!token) return { error: NOT_CONFIGURED };
  return withTrace(async () => {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const sheets = await coopSheet.readSheets({ bytes, name: file.name }, token);
      return { sheets };
    } catch (err) {
      await recordFailure({ event: "coop.sheet.failed", error: err, actorId: session.user.id });
      const detail = err instanceof Error ? err.message : "";
      return { error: `Nie udało się wczytać pliku${detail ? `: ${detail}` : "."}` };
    }
  });
}

export async function getCoopMapping(cooperative: string): Promise<ColumnMapping | null> {
  await requireSession();
  return cooperative.trim() ? coopRegistry.getMapping(cooperative.trim()) : null;
}

const fieldKeys = COOP_FIELDS.map((f) => f.key) as [string, ...string[]];
const mappingSchema = z
  .object(
    Object.fromEntries(
      fieldKeys.map((k) => [
        k,
        k === "flatNumber"
          ? z.union([z.number().int().min(0), z.literal("absent"), z.null()]).optional()
          : z.number().int().min(0).nullable().optional(),
      ]),
    ),
  )
  .strict() as z.ZodType<ColumnMapping>;

const skippedRef = z.object({
  row: z.number().int().min(0),
  reason: z.enum(["summary", "empty", "bad_number", "bad_date", "duplicate"]),
});
const warnedRef = z.object({
  row: z.number().int().min(0),
  reason: z.enum(["no_flat", "no_flat_merge"]),
});

const startSchema = z.object({
  cooperative: z.string().trim().min(1).max(200),
  fileName: z.string().trim().min(1).max(300),
  mapping: mappingSchema,
  skipped: z.array(skippedRef).max(100_000),
  warnings: z.array(warnedRef).max(100_000),
});

/** What the browser hands back from `parseCoopSheet` — re-validated, re-keyed. */
const rowSchema = z.object({
  cooperative: z.string().trim().min(1).max(200),
  address: z.string().trim().min(1).max(300),
  buildingNumber: z.string().trim().max(50),
  flatNumber: z.string().trim().max(50),
  area: z.number().positive(),
  priceTotal: z.number().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  priceKind: z.enum(PRICE_KINDS),
  rightType: z.enum(PROPERTY_RIGHTS).nullable(),
  rep: z.string().trim().max(100).nullable(),
  floor: z.number().int().nullable(),
  rooms: z.number().int().nullable(),
  buildYear: z.number().int().nullable(),
});

const chunkSchema = z.object({
  batchId: z.string().uuid(),
  city: z.string().trim().min(1).max(100),
  rows: z.array(rowSchema).min(1).max(IMPORT_CHUNK),
});

const finalizeSchema = startSchema.extend({
  batchId: z.string().uuid(),
  rowsTotal: z.number().int().min(0),
  totals: z.object({
    attempted: z.number().int().min(0),
    inserted: z.number().int().min(0),
    duplicates: z.number().int().min(0),
    geocoded: z.number().int().min(0),
    needsFix: z.number().int().min(0),
    usedNominatim: z.boolean(),
  }),
});

const INVALID = "Nieprawidłowe dane importu — wczytaj plik ponownie.";
const GENERIC = "Import nie powiódł się — spróbuj ponownie.";

export async function startCoopImportAction(
  input: z.input<typeof startSchema>,
): Promise<Ok<{ batchId: string }> | Fail> {
  const session = await requireSession();
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { error: INVALID };
  try {
    return await startCoopImport(
      { registry: coopRegistry },
      {
        ...parsed.data,
        skipped: parsed.data.skipped as never,
        warnings: parsed.data.warnings as never,
        userId: session.user.id,
      },
    );
  } catch (err) {
    await recordFailure({
      event: "coop.import.start.failed",
      error: err,
      actorId: session.user.id,
    });
    return { error: GENERIC };
  }
}

export async function importCoopChunkAction(
  input: z.input<typeof chunkSchema>,
): Promise<Ok<CoopChunkResult> | Fail> {
  const session = await requireSession();
  const parsed = chunkSchema.safeParse(input);
  if (!parsed.success) return { error: INVALID };
  const token = mintWorkerToken();
  if (!token) return { error: NOT_CONFIGURED };
  const rows: NewCoopTransaction[] = parsed.data.rows.map((r) => ({
    ...r,
    pos: null,
    source: "xls",
    dedupeKey: coopDedupeKey(r),
  }));
  try {
    return await withTrace(() =>
      importCoopChunk(
        { registry: coopRegistry, geocoder },
        {
          batchId: parsed.data.batchId,
          city: parsed.data.city,
          rows,
          userId: session.user.id,
          workerToken: token,
        },
      ),
    );
  } catch (err) {
    await recordFailure({
      event: "coop.import.chunk.failed",
      error: err,
      actorId: session.user.id,
    });
    return { error: GENERIC };
  }
}

export async function finalizeCoopImportAction(
  input: z.input<typeof finalizeSchema>,
): Promise<Ok<CoopImportSummary> | Fail> {
  const session = await requireSession();
  const parsed = finalizeSchema.safeParse(input);
  if (!parsed.success) return { error: INVALID };
  try {
    return await withTrace(() =>
      finalizeCoopImport(
        { registry: coopRegistry, eventLog },
        {
          ...parsed.data,
          userId: session.user.id,
          traceId: currentTraceId(),
        },
      ),
    );
  } catch (err) {
    await recordFailure({
      event: "coop.import.finalize.failed",
      error: err,
      actorId: session.user.id,
    });
    return { error: GENERIC };
  }
}
