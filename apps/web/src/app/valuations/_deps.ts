import { db } from "@/db/client";
import { valuationRepo } from "@/adapters/valuation-drizzle";
import { httpWorker } from "@/adapters/worker-http";
import { httpSampleProposal } from "@/adapters/sample-http";
import { httpSubjectProposal } from "@/adapters/subject-http";
import { pgStorage } from "@/adapters/storage-pg";
import { profileRepo } from "@/adapters/profile-drizzle";

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
export const storage = pgStorage(db);
export const profileRepository = profileRepo(db);
