/**
 * Fails when the deployed database is missing migrations the repo carries,
 * or carries migrations the repo does not know about.
 *
 * This exists because the drift it detects went unnoticed for a month. On
 * 2026-08-19 the deployed schema had `stub_wr` already nullable — the change
 * migration 0010 makes — while `drizzle.__drizzle_migrations` had no record
 * of it: someone had run the ALTER by hand. The schema was right and the
 * ledger lied, which is the worse of the two failures. A missing migration
 * announces itself the first time a write needs it; a hand-applied one is
 * silent until somebody trusts the ledger, and the next `drizzle-kit migrate`
 * replays it. That replay happened to be a harmless no-op. Had 0010 been an
 * `ADD COLUMN`, it would have aborted the whole run — including the migration
 * actually needed that day.
 *
 * Deliberately a COUNT comparison and nothing cleverer: it needs one query,
 * no schema introspection, and no assumptions about what a migration does. It
 * catches "the ledger and the repo disagree", which is the condition worth
 * knowing. It does NOT catch a hand-applied change that was also recorded, or
 * a schema edited outside migrations entirely — those need a real diff, and
 * `drizzle-kit check` is the tool for that day.
 *
 * Skips silently without STAGING_DATABASE_URL, so forks and local runs are
 * unaffected.
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";

const url = process.env.STAGING_DATABASE_URL;
if (!url) {
  console.log("[drift] brak STAGING_DATABASE_URL — pomijam kontrolę.");
  process.exit(0);
}

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
  entries: { idx: number; tag: string }[];
};
const inRepo = journal.entries.length;

const client = new Client({ connectionString: url });
await client.connect();
try {
  const { rows } = await client.query<{ n: string }>(
    "select count(*)::text as n from drizzle.__drizzle_migrations",
  );
  const applied = Number(rows[0]!.n);

  if (applied === inRepo) {
    console.log(`[drift] zgodne — ${applied} migracji w repo i na wdrożonej bazie.`);
    process.exit(0);
  }

  if (applied < inRepo) {
    const missing = journal.entries.slice(applied).map((e) => e.tag);
    console.error(
      `[drift] wdrożona baza jest za repo: zastosowano ${applied} z ${inRepo}.\n` +
        `        brakuje: ${missing.join(", ")}\n` +
        `        Uruchom migracje PRZED wdrożeniem nowego kodu — Drizzle wypisuje jawną\n` +
        `        listę kolumn, więc nowy kod na starym schemacie zwraca 500 na każdym\n` +
        `        odczycie wyceny, a nie degraduje pojedynczą funkcję.`,
    );
    process.exit(1);
  }

  console.error(
    `[drift] wdrożona baza wyprzedza repo: zastosowano ${applied}, repo zna ${inRepo}.\n` +
      `        Ktoś zastosował migrację spoza tej gałęzi albo ręcznie. Ustal co, zanim\n` +
      `        cokolwiek wdrożysz — kolejny 'drizzle-kit migrate' może odtworzyć zmianę,\n` +
      `        która już istnieje, i przerwać całą serię.`,
  );
  process.exit(1);
} finally {
  await client.end();
}
