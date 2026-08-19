import pino from "pino";

/**
 * Every field that may ever reach a log line. This is an ALLOWLIST, and the
 * direction matters: pino's `redact` enumerates what to hide, so one
 * forgotten path is a leak. Here a forgotten field is merely absent from the
 * log. Addresses, land-registry data and prose text are simply not on the
 * list, so they cannot escape through an oversight (spec §Bramka RODO).
 */
export const ALLOWED_KEYS = [
  "event",
  "traceId",
  "valuationId",
  "actorId",
  "ms",
  "status",
  "count",
  "section",
  "model",
  "errName",
  "errMessage",
  "errStack",
] as const;

const MAX_ERR_MESSAGE = 300;
const MAX_ERR_STACK = 2000;

export type LogFields = Partial<Record<(typeof ALLOWED_KEYS)[number], string | number>> & {
  event: string;
};

/** Second layer behind the TypeScript type: strips at runtime what the type
 *  cannot (a value widened to `any`, a spread of untyped input). */
export function pickAllowed(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ALLOWED_KEYS) {
    const value = input[key];
    // Scalars only: an object on a permitted key could smuggle a whole
    // valuation payload through a legitimate name.
    if (typeof value !== "string" && typeof value !== "number") continue;
    if (key === "errMessage" && typeof value === "string") {
      out[key] = value.slice(0, MAX_ERR_MESSAGE);
    } else if (key === "errStack" && typeof value === "string") {
      out[key] = value.slice(0, MAX_ERR_STACK);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * `sync: true` is load-bearing, not a preference. Vercel functions run on AWS
 * Lambda, and pino's own docs warn that asynchronous logging there yields
 * "delayed or lost log messages, as logs may not be written to the
 * destination before the runtime is frozen". The freeze happens right after
 * the response — i.e. right after we log a failure. Spike finding, 2026-08-19:
 * a local run never shows it, because a local process does not freeze.
 *
 * `base: undefined` drops pid/hostname: noise on serverless, where both are
 * meaningless.
 */
const pinoLogger = pino({ base: undefined }, pino.destination({ sync: true }));

export const log = {
  info: (fields: LogFields) => pinoLogger.info(pickAllowed(fields)),
  warn: (fields: LogFields) => pinoLogger.warn(pickAllowed(fields)),
  error: (fields: LogFields) => pinoLogger.error(pickAllowed(fields)),
};

/** Flattens an unknown thrown value into allowlisted fields. */
export function errFields(error: unknown): Pick<LogFields, "errName" | "errMessage" | "errStack"> {
  if (error instanceof Error) {
    return { errName: error.name, errMessage: error.message, errStack: error.stack ?? "" };
  }
  return { errName: "NonError", errMessage: String(error) };
}
