import { eventLog } from "@/app/valuations/_deps";
import type { AppEvent } from "@/ports/event-log";
import { errFields, log } from "@/lib/log";
import { currentTraceId } from "@/lib/trace";

/**
 * Telemetry must never be the reason a feature breaks.
 *
 * Two ways it could be, both seen in review:
 *  - the write THROWS. `event_log` may not exist yet: migrations are applied
 *    by the production build, so a freshly deployed preview runs new code
 *    against the old schema. An unguarded insert turns a successful RCN fetch
 *    into a raw Postgres message on the appraiser's screen.
 *  - the write HANGS. `pg`'s Pool defaults to `connectionTimeoutMillis: 0` —
 *    queue forever. A sick database is the usual reason we are logging at
 *    all, so an unbounded await parks the very request trying to report it,
 *    until the function is killed and the appraiser gets nothing.
 *
 * So: swallow the failure, and give up after a bounded wait. A missing row is
 * a worse trail; a thrown or hung request is a broken product.
 */
const WRITE_TIMEOUT_MS = 2000;

export async function recordEvent(entry: AppEvent): Promise<void> {
  try {
    await Promise.race([
      eventLog.record(entry),
      new Promise<void>((resolve) => setTimeout(resolve, WRITE_TIMEOUT_MS).unref?.()),
    ]);
  } catch (writeError) {
    log.error({ event: "eventLog.writeFailed", traceId: entry.traceId, ...errFields(writeError) });
  }
}

/**
 * One failure, two sinks: stdout gets everything, Postgres gets what has to
 * outlive the hosting provider's log retention.
 *
 * The database write is deliberately NOT awaited into the caller's error
 * path. This function runs inside a `catch` block, so a throw from here would
 * escape that block, replace the real cause with a database error, and hand
 * the appraiser a raw exception instead of a Polish message — the logging
 * layer destroying the diagnosis it exists to preserve, precisely when the
 * infrastructure is already unwell. If the row cannot be written, the stdout
 * line above has already gone out and that is the whole remedy.
 */
export async function recordFailure(args: {
  event: string;
  /** Optional: not every failure arrives as a throw. `approveValuation`'s map
   *  freeze, for instance, fails by returning null — no exception, but every
   *  bit as much a failure worth keeping. */
  error?: unknown;
  valuationId?: string;
  actorId?: string;
}): Promise<void> {
  const traceId = currentTraceId();
  const fields = errFields(args.error);

  // `log.error` is INSIDE the try as well. pino writes synchronously to fd 1
  // (required on Lambda, see log.ts), and a synchronous write to a pipe can
  // throw — EAGAIN under load, EPIPE after the reader goes away. That throw
  // would happen inside the caller's `catch` block, escape it, and replace
  // the real cause with a logging error: exactly what this function exists
  // to prevent, defeated by the line meant to do the preventing.
  try {
    log.error({
      event: args.event,
      traceId,
      valuationId: args.valuationId,
      actorId: args.actorId,
      ...fields,
    });
  } catch {
    // Nothing to do and nowhere to say it — the logger is the thing that broke.
  }

  await recordEvent({
    level: "error",
    event: args.event,
    traceId,
    valuationId: args.valuationId,
    actorId: args.actorId,
    meta: fields,
  });
}
