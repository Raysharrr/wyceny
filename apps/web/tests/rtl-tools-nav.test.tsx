// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { TOOLS } from "@/components/tools";
import { ToolsNav } from "@/components/tools-nav";

const pathname = vi.hoisted(() => ({ value: "/rejestr/import" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.value }));

afterEach(cleanup);

describe("ToolsNav (T-22)", () => {
  it("ma rejestr i konwerter, w tej kolejności", () => {
    expect(TOOLS.map((t) => [t.href, t.label])).toEqual([
      ["/rejestr", "Rejestr spółdzielczy"],
      ["/narzedzia/rcn-pdf", "Wydruk z RCN → Excel"],
    ]);
  });

  it("oznacza bieżące narzędzie także na jego podstronach", () => {
    pathname.value = "/rejestr/import";
    render(<ToolsNav />);
    expect(screen.getByRole("link", { name: "Rejestr spółdzielczy" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Wydruk z RCN → Excel" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("na rozdrożu /narzedzia nie renderuje się wcale", () => {
    pathname.value = "/narzedzia";
    const { container } = render(<ToolsNav />);
    expect(container).toBeEmptyDOMElement();
  });
});
