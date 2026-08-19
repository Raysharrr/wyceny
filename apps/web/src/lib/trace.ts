import { AsyncLocalStorage } from "node:async_hooks";

/**
 * One id per request, ambient for its whole async chain.
 *
 * A module-level variable cannot work here: Node serves concurrent requests on
 * one event loop, so two appraisers would overwrite each other's id and the
 * traces would cross. AsyncLocalStorage pins the value to the async call
 * chain instead, which is what lets the five worker adapters keep their
 * current signatures (spec §Architektura).
 */
const store = new AsyncLocalStorage<{ traceId: string }>();

export function newTraceId(): string {
  return crypto.randomUUID().slice(0, 8);
}

/**
 * Runs `fn` under a trace id, reusing the ambient one when there already is
 * one. The reuse is the point: `withTrace` wraps every Server Action body and
 * the adapters read the id from inside that scope, so a traced call landing
 * inside another traced call is a shape this codebase invites. Minting a
 * second id there would split one run in half and quietly break the
 * correlation the whole slice exists to provide.
 */
export function withTrace<T>(fn: () => Promise<T>): Promise<T> {
  return store.run({ traceId: currentTraceId() ?? newTraceId() }, fn);
}

/**
 * Appends the trace code to a user-facing Polish message, so the appraiser can
 * read it back and we can find the run. Adds nothing when untraced — a bare
 * "(kod: undefined)" would be worse than no code at all.
 */
export function errorWithCode(message: string): string {
  const traceId = currentTraceId();
  return traceId ? `${message} (kod: ${traceId})` : message;
}

/** Headers that carry the trace across the web↔worker boundary (ADR-009). */
export function traceHeaders(): Record<string, string> {
  const traceId = currentTraceId();
  return traceId ? { "X-Request-Id": traceId } : {};
}

export function currentTraceId(): string | undefined {
  return store.getStore()?.traceId;
}
