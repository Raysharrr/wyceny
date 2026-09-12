import { db } from "@/db/client";
import { valuationRepo } from "@/adapters/valuation-drizzle";
import { httpWorker } from "@/adapters/worker-http";
import { httpSampleProposal } from "@/adapters/sample-http";
import { coopRegistrySampleProposal } from "@/adapters/sample-coop-registry";
import { mintWorkerToken } from "@/lib/worker-token";
import type { PropertyRight } from "@/domain/property-right";
import type { PortSampleProposal } from "@/ports/sample";
import { httpSubjectProposal } from "@/adapters/subject-http";
import { httpAddressSuggest } from "@/adapters/suggest-http";
import { httpProseProposal } from "@/adapters/prose-http";
import { httpMapImages } from "@/adapters/maps-http";
import { pgStorage } from "@/adapters/storage-pg";
import { profileRepo } from "@/adapters/profile-drizzle";
import { eventLogRepo } from "@/adapters/event-log-drizzle";
import { coopRegistryRepo } from "@/adapters/coop-registry-drizzle";
import { httpCoopSheet } from "@/adapters/coop-sheet-http";
import { httpGeocoder } from "@/adapters/geocoder-http";
import { log } from "@/lib/log";
import { googleStreetView } from "@/adapters/street-view-google";
import type { PortMapImages } from "@/ports/maps";
import type { PortStreetView } from "@/ports/street-view";

/**
 * Adapters wired once at the app layer (F-10: domain/ports stay pure — only
 * `app/` is allowed to know concrete adapters). Shared singleton instances
 * so the create-valuation Server Action's `storage.put` and the
 * `/api/docs/[key]` route's `storage.get` hit the same store.
 *
 * `storage` is Postgres-backed (Task 11a) — persistent across serverless
 * invocations, unlike `storage-memory.ts` (still kept as a reference
 * adapter with its own unit test, just not wired here).
 */
export const valuationRepository = valuationRepo(db);
export const worker = httpWorker(process.env.WORKER_URL ?? "http://localhost:8000");
export const sampleProposal = httpSampleProposal(process.env.WORKER_URL ?? "http://localhost:8000");
export const subjectData = httpSubjectProposal(process.env.WORKER_URL ?? "http://localhost:8000");
export const addressSuggest = httpAddressSuggest(process.env.WORKER_URL ?? "http://localhost:8000");
export const proseProposal = httpProseProposal(process.env.WORKER_URL ?? "http://localhost:8000");
/** Slice 9: null when MAPS_FETCH=off (CI e2e stays network-free) — approve then renders the honest stub. */
export const mapImages: PortMapImages | null =
  process.env.MAPS_FETCH === "off"
    ? null
    : httpMapImages(process.env.WORKER_URL ?? "http://localhost:8000");
export const storage = pgStorage(db);
export const profileRepository = profileRepo(db);
export const eventLog = eventLogRepo(db);
/** T-13 (S2a): the office's cooperative register, the XLSX reader and the batch geocoder behind it. */
export const coopRegistry = coopRegistryRepo(db);
export const coopSheet = httpCoopSheet(process.env.WORKER_URL ?? "http://localhost:8000");
export const geocoder = httpGeocoder(process.env.WORKER_URL ?? "http://localhost:8000", (errName) =>
  log.warn({ event: "coop.geocode.chunk_failed", errName }),
);
/**
 * T-14 (S3): the second `PortSampleProposal` — the office coop register. The
 * subject is geocoded through the worker's batch endpoint (UUG → Nominatim),
 * one address at a time; a miss is a Polish error the Server Action shows
 * verbatim, never a silent empty pool.
 */
export const coopSampleProposal = coopRegistrySampleProposal(coopRegistry, async (address) => {
  const token = mintWorkerToken();
  if (!token) throw new Error("Brak konfiguracji geokodera (WORKER_SHARED_SECRET).");
  const [hit] = await geocoder.geocodeMany([address], token);
  if (!hit) {
    throw new Error(
      "Nie udało się ustalić położenia przedmiotu wyceny — popraw adres w kroku 1 i spróbuj ponownie.",
    );
  }
  return hit;
});
/** The ONE switch on the kind of right in the whole block (spec §4.2): which register feeds step 3. */
export function sampleProposalFor(right: PropertyRight): PortSampleProposal {
  return right === "spoldzielcze_wlasnosciowe" ? coopSampleProposal : sampleProposal;
}
/** Slice 3: null without GOOGLE_STREET_VIEW_KEY or with NEXT_PUBLIC_STREET_VIEW=off (CI e2e) — step 3 then renders placeholders. */
export const streetView: PortStreetView | null =
  process.env.NEXT_PUBLIC_STREET_VIEW === "off" || !process.env.GOOGLE_STREET_VIEW_KEY
    ? null
    : googleStreetView(process.env.GOOGLE_STREET_VIEW_KEY);
