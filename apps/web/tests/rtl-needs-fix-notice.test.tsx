// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { NeedsFixNotice } from "@/app/rejestr/import/needs-fix-notice";

afterEach(cleanup);

describe("NeedsFixNotice (review 2 N-1)", () => {
  it("renders nothing at 0 — no 'Pokaż 0 wierszy' link", () => {
    const { container } = render(<NeedsFixNotice needsFix={0} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("links to the 'do poprawki' list when there are rows", () => {
    render(<NeedsFixNotice needsFix={2} />);
    expect(screen.getByRole("link", { name: "Pokaż 2 wiersze" })).toHaveAttribute(
      "href",
      "/rejestr?lokalizacja=do-poprawki&okres=all",
    );
  });
});
