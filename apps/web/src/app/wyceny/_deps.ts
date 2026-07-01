import { db } from "@/db/client";
import { wycenyRepo } from "@/adapters/wyceny-drizzle";
import { httpWorker } from "@/adapters/worker-http";
import { memoryStorage } from "@/adapters/storage-memory";

/**
 * Adapters wired once at the app layer (F-10: domain/ports stay pure — only
 * `app/` is allowed to know concrete adapters). Shared singleton instances
 * so the create-wycena Server Action's `storage.put` and the
 * `/api/docs/[key]` route's `storage.get` hit the same in-memory store.
 */
export const wycenyRepository = wycenyRepo(db);
export const worker = httpWorker(process.env.WORKER_URL ?? "http://localhost:8000");
export const storage = memoryStorage();
