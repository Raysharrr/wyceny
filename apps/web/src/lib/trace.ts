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

export function withTrace<T>(fn: () => Promise<T>): Promise<T> {
  return store.run({ traceId: newTraceId() }, fn);
}

export function currentTraceId(): string | undefined {
  return store.getStore()?.traceId;
}
