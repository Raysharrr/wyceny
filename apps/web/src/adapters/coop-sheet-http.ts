import { z } from "zod";
import type { CoopSheet, PortCoopSheet } from "../ports/coop-sheet";
import { traceHeaders } from "../lib/trace";

const wireSchema = z.object({
  sheets: z.array(
    z.object({ name: z.string(), cols: z.number(), rows: z.array(z.array(z.string())) }),
  ),
});

/** 12 MB file over a local/regional hop plus openpyxl streaming — well under a minute. */
const TIMEOUT_MS = 55_000;

/** HTTP adapter for {@link PortCoopSheet} — multipart to the worker's `POST /coop-sheet`, token-gated like `/kw-extract`. */
export function httpCoopSheet(baseUrl: string): PortCoopSheet {
  return {
    async readSheets(file, token): Promise<CoopSheet[]> {
      const form = new FormData();
      form.set(
        "file",
        new Blob([file.bytes as BlobPart], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        file.name,
      );
      form.set("token", token);
      const response = await fetch(`${baseUrl}/coop-sheet`, {
        method: "POST",
        headers: traceHeaders(),
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { detail?: string };
        throw new Error(body.detail ?? `worker /coop-sheet responded ${response.status}`);
      }
      return wireSchema.parse(await response.json()).sheets;
    },
  };
}
