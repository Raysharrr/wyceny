import { like } from "drizzle-orm";
import { db, pool } from "../src/db/client";
import * as schema from "../src/db/schema";

/**
 * Removes what the E2E spec leaves in the office register: every cooperative
 * named `SM QA E2E <runId>` (rows, import batches, remembered mapping). ~130 rows
 * and ~6 cooperatives per run — on a long-lived register (staging) run this
 * after every `pnpm e2e:staging`. The `QA E2E …` valuation drafts are left
 * alone on purpose (audit trail, photos and documents hang off a valuation —
 * the administrator removes those through the app):
 *
 *   DATABASE_URL=<DATABASE_PUBLIC_URL stagingu> pnpm e2e:cleanup
 *
 * Deletes ONLY by the QA prefixes; nothing else in the register is touched.
 */
const COOP_PREFIX = "SM QA E2E %";

async function main() {
  const tx = await db
    .delete(schema.coopTransaction)
    .where(like(schema.coopTransaction.cooperative, COOP_PREFIX))
    .returning({ id: schema.coopTransaction.id });
  const batches = await db
    .delete(schema.coopImportBatch)
    .where(like(schema.coopImportBatch.cooperative, COOP_PREFIX))
    .returning({ id: schema.coopImportBatch.id });
  const mappings = await db
    .delete(schema.coopColumnMapping)
    .where(like(schema.coopColumnMapping.cooperative, COOP_PREFIX))
    .returning({ cooperative: schema.coopColumnMapping.cooperative });
  console.log(
    `e2e-cleanup: usunięto ${tx.length} wierszy rejestru, ${batches.length} partii, ${mappings.length} mapowań (SM QA E2E …); szkice „QA E2E …” zostają`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
