// `log` only, and never the Postgres event sink: this file lives under
// `lib/`, which F-10 forbids from importing `adapters/**` (depcruise rule
// `adapters-wired-only-at-app-layer`). Threading a port through a map-freeze
// retry that already degrades gracefully would cost more than its failures
// are worth outliving stdout.
import { errFields, log } from "@/lib/log";
import type { PortStorage } from "@/ports/storage";
import type { PortValuation, SessionUser, Valuation } from "@/ports/valuation";

/**
 * Structurally the renderer's `RenderMaps`, spelled out rather than imported:
 * `adapters/**` may only be reached from `app/**` (F-10 depcruise rule
 * `adapters-wired-only-at-app-layer`), and dependency-cruiser follows
 * type-only imports too (`tsPreCompilationDeps`). The app layer passes what
 * this returns straight to `renderOperatDocx`, so the two shapes are checked
 * against each other at every call site.
 */
type FrozenMaps = { ewidencyjna: Buffer; orto: Buffer };

/**
 * The two storage keys the §8.1 maps live under, for one valuation.
 *
 * They are spelled once here because four call sites now depend on them
 * agreeing exactly — the preview freezes, the issue reuses, the mapless arm
 * of the issue deletes, and `signValuationAction` re-renders from them and
 * reads their absence as "approved without maps". A typo in any one of those
 * is a signed operat that silently differs from the approved one.
 */
export const frozenMapKeys = (id: string) => ({
  ewidencyjna: `mapa-ewidencyjna-${id}.png`,
  orto: `mapa-orto-${id}.jpg`,
});

/**
 * Reads the frozen §8.1 maps back, or `null` when they are not there to read.
 *
 * ANY failure means "not frozen after all" — deliberately unlike
 * `signValuationAction`, which treats everything but `StorageNotFoundError`
 * as a hard error. The two are protecting opposite things: a sign that
 * silently dropped maps would issue a signed document without them, whereas
 * a reader that fails here simply fetches them again. Falling back to a fetch
 * cannot lose maps; it can only cost seconds.
 *
 * That is also why a marker is never taken as proof on its own: it is a claim
 * about bytes, and bytes can be gone (an eviction, a half-finished cleanup)
 * while the claim still stands.
 */
export async function readFrozenMaps(
  storage: PortStorage,
  id: string,
  context: string,
): Promise<FrozenMaps | null> {
  const keys = frozenMapKeys(id);
  try {
    const ewidencyjna = await storage.get(keys.ewidencyjna);
    const orto = await storage.get(keys.orto);
    if (Buffer.isBuffer(ewidencyjna) && Buffer.isBuffer(orto)) {
      return { ewidencyjna, orto };
    }
  } catch (error) {
    log.error({
      event: `${context}.frozenMaps.readFailed`,
      valuationId: id,
      ...errFields(error),
    });
  }
  return null;
}

/**
 * Drops the §8.1 map bytes the caller just wrote — but ONLY on positive
 * evidence that they are still this draft's to drop.
 *
 * `freezeMaps` answers `null` for three different reasons and the caller
 * cannot tell them apart from the return value alone:
 *
 *  1. **not the owner** — both callers authorise through `get`, which admits
 *     an admin, while `freezeMaps` is owner-only. The bytes just written then
 *     sit under whatever marker was there BEFORE, which may be the previous
 *     address: correct the address back and the next reader gets the other
 *     parcel's maps under a marker that looks perfectly valid. These bytes
 *     must GO.
 *  2. **no longer a draft** — someone else's approve committed while this
 *     call was inside its multi-second WMS fetch. The bytes under those keys
 *     are now the ISSUE's: `signValuationAction` re-renders from exactly them
 *     and reads their absence as "approved without maps", silently. These
 *     bytes must STAY — deleting them would put an illustrated operat in the
 *     record and an unillustrated one under the signature.
 *  3. **the row is gone** — or the read that would tell us fails. Unknowable,
 *     and it is the case where a stale answer is most likely.
 *
 * So the condition is single and positive: delete only when a fresh read
 * still shows a draft we can see. Everything else keeps the bytes, because
 * the two costs are not comparable — an orphaned byte pair costs one
 * re-fetch and is overwritten by the next render, while bytes deleted out
 * from under an issued operat cost a signed document that silently differs
 * from the approved one.
 *
 * Whether the bytes go is ALL this decides — what the caller does next is
 * its own business, and the two callers differ on purpose. `approveValuation`
 * refuses: a freeze it cannot vouch for must not become a signature.
 * `previewOperat` falls through and renders: a preview claims nothing, and
 * withholding the screen over a marker the appraiser never sees would cost
 * them the one thing this whole slice exists to give them.
 */
export async function dropMapBytesIfStillOurDraft(
  deps: { storage: PortStorage; valuationRepository: PortValuation },
  id: string,
  user: SessionUser,
  context: string,
): Promise<void> {
  let still: Valuation | null = null;
  try {
    still = await deps.valuationRepository.get(id, user);
  } catch (error) {
    log.error({
      event: `${context}.frozenMaps.freezeCheckFailed`,
      valuationId: id,
      actorId: user.id,
      ...errFields(error),
    });
    return;
  }
  if (still?.status !== "in_progress") {
    // Bytes left where they are: they may already belong to the issued operat.
    log.error({
      event: `${context}.frozenMaps.bytesKept`,
      valuationId: id,
      actorId: user.id,
      status: still?.status ?? "gone",
    });
    return;
  }
  log.warn({ event: `${context}.frozenMaps.bytesDropped`, valuationId: id, actorId: user.id });
  const keys = frozenMapKeys(id);
  await deps.storage.delete(keys.ewidencyjna);
  await deps.storage.delete(keys.orto);
}
