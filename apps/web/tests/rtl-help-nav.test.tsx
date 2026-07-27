// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { HelpNav, HelpTreeSection } from "@/components/help/help-nav";
import { TREE_LABEL, type HelpPage } from "@/content/pomoc/manifest";

// vitest doesn't expose globals, so @testing-library/react's auto-cleanup
// never registers. Mirrors tests/rtl-pomoc-page.test.tsx.
afterEach(cleanup);

const fakePage = (slug: string, title: string): HelpPage => ({
  slug,
  title,
  tree: "jak-korzystac",
  order: 1,
  tags: [],
  summary: `Streszczenie ${title}.`,
  load: async () => ({ default: () => null }),
});

describe("HelpNav", () => {
  it("pokazuje oba drzewa", () => {
    render(<HelpNav />);
    expect(screen.getByRole("heading", { name: TREE_LABEL["jak-korzystac"] })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: TREE_LABEL.metodyka })).toBeInTheDocument();
  });

  it("linkuje do stron po slugu", () => {
    render(<HelpNav />);
    const link = screen.getByRole("link", { name: /pierwsze kroki/i });
    expect(link).toHaveAttribute("href", "/pomoc/pierwsze-kroki");
  });
});

// Asserted against injected page lists rather than the live manifest: Task 14
// fills the `metodyka` tree, and a test pinned to "the second tree is empty
// today" would go red for the wrong reason.
describe("HelpTreeSection", () => {
  it("pokazuje notke zamiast pustej listy w drzewie bez stron", () => {
    render(<HelpTreeSection label="Puste drzewo" pages={[]} />);
    expect(screen.getByText(/wkrótce/i)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  // The other half: without it an unconditional note — shown next to a full
  // list of links — satisfies the case above.
  it("nie pokazuje notki, gdy drzewo ma strony", () => {
    render(
      <HelpTreeSection
        label="Pelne drzewo"
        pages={[fakePage("alfa", "Alfa"), fakePage("beta", "Beta")]}
      />,
    );
    expect(screen.queryByText(/wkrótce/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Beta" })).toHaveAttribute("href", "/pomoc/beta");
    expect(screen.getByText("Streszczenie Alfa.")).toBeInTheDocument();
  });
});
