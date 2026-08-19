import { expect } from "vitest";

/**
 * The action's Polish sentence followed by the trace code `errorWithCode`
 * appends inside a `withTrace` scope.
 *
 * Anchored on purpose. The assertions this replaces were exact equality, and
 * what they were guarding is that a failed action returns EXACTLY the sentence
 * written for the appraiser — never a stack trace, never a worker's internal
 * hostname. That guarantee has to survive the code being appended to it, so
 * the matcher pins both ends of the string rather than merely looking for the
 * sentence somewhere inside it.
 */
export const withCode = (message: string) =>
  expect.stringMatching(
    new RegExp(`^${message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(kod: [0-9a-f]{8}\\)$`),
  );
