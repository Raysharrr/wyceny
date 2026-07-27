// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// The live manifest has no step pages yet — they land in Tasks 7 and 8. A test
// pinned to "today's manifest happens to lack krok-6-opisy" would prove the
// guard now and go red for the wrong reason the moment that page ships, so the
// lookup is injected instead (same reasoning as `HelpTreeSection`'s injected
// `pages` in tests/rtl-help-nav.test.tsx). Exactly one slug resolves here, which
// also pins that `getPage` is called with the step's own `helpSlug` — and that
// StepHeader really consults the manifest at all.
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
  // and every step gets a dead link until Task 8. Queried without a name filter
  // on purpose: a link that lost its label too must still fail here.
  it("nie renderuje linku, gdy strona kroku nie istnieje w manifeście", () => {
    render(<StepHeader step={6} />);

    expect(screen.queryByRole("link")).toBeNull();
  });

  // `step-meta.ts` is not mocked, so this is the real slug table. The manifest
  // side of the contract (that these 7 slugs exist) becomes assertable only once
  // Tasks 7–8 add the pages.
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
