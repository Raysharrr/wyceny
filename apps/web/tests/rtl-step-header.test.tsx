// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Since Task 8 every one of the seven steps HAS a Pomoc page, so the negative
// case can no longer lean on a step the manifest happens to miss. The lookup is
// injected instead (same reasoning as `HelpTreeSection`'s injected `pages` in
// tests/rtl-help-nav.test.tsx): this stub resolves exactly one slug, so the
// "no page → no link" branch stays exercised no matter what the live manifest
// holds, and stays green when Fala 2 adds more pages. The single resolving slug
// also pins that `getPage` is called with the step's own `helpSlug` — and that
// StepHeader really consults the manifest at all. That the seven real slugs do
// resolve against the real manifest is the complementary assertion, in
// tests/help-manifest.test.ts.
// The literal is inlined: the factory runs while `@/components/wizard/step-header`
// is being imported, before any module-scope const of this file exists.
vi.mock("@/content/pomoc/manifest", () => ({
  getPage: (slug: string) =>
    slug === "krok-1-przedmiot"
      ? {
          slug,
          title: "Krok 1 — przedmiot wyceny",
          tree: "jak-korzystac",
          order: 1,
          tags: [],
          summary: "Streszczenie kroku 1.",
          load: async () => ({ default: () => null }),
        }
      : undefined,
}));

import { StepHeader } from "@/components/wizard/step-header";
import { STEP_META } from "@/components/wizard/step-meta";

// vitest doesn't expose globals, so RTL's auto-cleanup never registers.
afterEach(cleanup);

describe("StepHeader — wejście do Pomocy", () => {
  it("renderuje link do Pomocy dla kroku ze stroną w manifeście", () => {
    render(<StepHeader step={1} />);

    const link = screen.getByRole("link", { name: /pomoc/i });
    expect(link).toHaveAttribute("href", "/pomoc/krok-1-przedmiot");
    // Explicit, because the accessible name has exactly one source: the icon is
    // `aria-hidden` and the anchor carries no text. Were a `title` ever added as
    // a tooltip, it would silently keep the name query green with no label.
    expect(link).toHaveAttribute("aria-label", "Pomoc — ten krok");
  });

  // The other half — without it, an unconditional link satisfies the case above
  // and a step whose page is missing gets a dead link. `step={6}` is arbitrary:
  // any step but 1 hits the stub's `undefined` branch. Queried without a name
  // filter on purpose: a link that lost its label too must still fail here.
  it("nie renderuje linku, gdy strona kroku nie istnieje w manifeście", () => {
    render(<StepHeader step={6} />);

    expect(screen.queryByRole("link")).toBeNull();
  });

  // `step-meta.ts` is not mocked, so this is the real slug table. The manifest
  // side of the contract — that these 7 slugs really resolve — lives in
  // tests/help-manifest.test.ts (assertable since Task 8 shipped the pages).
  it("mapuje każdy krok na slug strony Pomocy", () => {
    const slugs = Object.fromEntries(
      Object.entries(STEP_META).map(([step, meta]) => [step, meta.helpSlug]),
    );

    expect(slugs).toEqual({
      1: "krok-1-przedmiot",
      2: "krok-2-ogledziny",
      3: "krok-3-proba",
      4: "krok-4-cechy",
      5: "krok-5-kalkulacja",
      6: "krok-6-opisy",
      7: "krok-7-operat",
    });
  });
});
