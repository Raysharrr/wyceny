import { eventLog } from "@/app/valuations/_deps";
import { errFields, log } from "@/lib/log";
import { currentTraceId } from "@/lib/trace";

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

  log.error({
    event: args.event,
    traceId,
    valuationId: args.valuationId,
    actorId: args.actorId,
    ...fields,
  });

  try {
    await eventLog.record({
      level: "error",
      event: args.event,
      traceId,
      valuationId: args.valuationId,
      actorId: args.actorId,
      meta: fields,
    });
  } catch (writeError) {
    log.error({
      event: "eventLog.writeFailed",
      traceId,
      ...errFields(writeError),
    });
  }
}
