/**
 * The one answer to "is the operat's prose generator turned on" (FR-6).
 *
 * ONE variable, `NEXT_PUBLIC_PROSE`, deliberately — two names could disagree,
 * and the halves they would control are not independent: a UI that offers the
 * editors while the server refuses to generate, or a gate demanding confirmed
 * descriptions the appraiser has no way to write, are both worse than either
 * flag alone. Unset means ON, like every other switch in this app.
 *
 * The two halves it controls behave differently, and that difference is the
 * point (verified against a real `next build`, not assumed):
 *
 *  - **Server** (this helper: the generator, the step's facts, the F-4
 *    requirement) — Next leaves `process.env.NEXT_PUBLIC_PROSE` as a runtime
 *    read in the server bundles, so flipping the variable on the host takes
 *    effect on the very next request. This is the brake that stops the
 *    spending, and it does NOT need a rebuild.
 *  - **Client** (`step-descriptions.tsx`, which keeps its own inline read on
 *    purpose) — inlined at build time, which is what lets the editors be
 *    dropped from the browser bundle entirely. Changing that half needs a
 *    redeploy.
 *
 * Server-side callers must go through here rather than re-typing the
 * comparison; the client component cannot (an indirect call would defeat the
 * dead-code elimination its half depends on).
 */
export function proseEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PROSE !== "off";
}
