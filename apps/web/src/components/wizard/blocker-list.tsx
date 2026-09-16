import Link from "next/link";
import type { Blocker } from "@/domain/provenance";
import { blockerTarget } from "@/domain/wizard";

/**
 * What stands between a draft and its operat, each item linked to the step
 * that owns it.
 *
 * Since T8 step 7 confirms nothing: the four bulk buttons asked the appraiser
 * to vouch for transactions, parcels and rating scales that screen never
 * showed. This list is what replaces them — a report plus a way back to the
 * screen where the data IS visible, which is where confirming happens now.
 *
 * EVERY blocker carries its own link, not just the first. A single global
 * sentence could name one problem and leave the rest for the next attempt;
 * once each one points at a different step, doing that would make the
 * appraiser discover the second problem only after fixing the first and
 * coming back — one round trip per blocker.
 *
 * No "use client": a plain presentational component, rendered from the
 * server-side step-7 card and from the client-side action bar alike.
 */
export function BlockerList({
  blockers,
  testId,
  role,
}: {
  blockers: Blocker[];
  testId: string;
  /** `alert` for a list that appears in response to a click (the approve
   * refusal); omitted for the card that is simply part of the page. */
  role?: "alert";
}) {
  return (
    <div data-testid={testId} role={role} className="flex flex-col gap-1">
      <p className="text-sm font-medium text-foreground">
        Zatwierdzenie zablokowane — do wyjaśnienia:
      </p>
      <ul className="list-disc pl-5 text-sm text-amber-600 dark:text-amber-500">
        {blockers.map((b) => {
          const target = blockerTarget(b.path);
          // Two kinds of destination, one link. B-15/B-16 are cleared on
          // /profile, not in any wizard step (ADR-020 cz. 1) — a `?step=`
          // link would send the appraiser to a screen that cannot clear them.
          const link =
            target?.kind === "step"
              ? {
                  href: `?step=${target.step.n}`,
                  text: `Przejdź do kroku ${target.step.n}. ${target.step.label}`,
                }
              : target
                ? { href: target.href, text: `Przejdź do: ${target.label}` }
                : null;
          return (
            <li key={b.path}>
              {b.label}
              {link ? (
                <>
                  {" "}
                  <Link
                    href={link.href}
                    className="font-medium underline underline-offset-2 hover:text-primary"
                  >
                    {link.text}
                  </Link>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
