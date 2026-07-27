// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const redirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));

const getSession = vi.fn();
vi.mock("@/auth/session", () => ({ getSession: () => getSession() }));

import Page from "@/app/pomoc/page";

// vitest doesn't expose globals, so @testing-library/react's auto-cleanup
// never registers. Mirrors tests/rtl-foot-nav.test.tsx.
afterEach(cleanup);
// The mocks are module-scope: without clearing, call counts leak between
// tests and the "did NOT redirect" assertion below would fail spuriously.
beforeEach(() => vi.clearAllMocks());

describe("/pomoc", () => {
  it("przekierowuje na login bez sesji", async () => {
    getSession.mockResolvedValueOnce(null);
    await Page();
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("renderuje naglowek Pomocy dla zalogowanego", async () => {
    getSession.mockResolvedValueOnce({
      user: { name: "Test", email: "t@t.pl", role: "appraiser" },
    });
    render(await Page());
    expect(screen.getByRole("heading", { name: /pomoc/i })).toBeInTheDocument();
  });

  // Guards the mutation an independent review caught: an UNCONDITIONAL
  // redirect("/login") passed both tests above, because the mocked redirect
  // doesn't throw and execution falls through to the JSX. Without this
  // assertion the page could be unreachable for everyone and still be green.
  it("NIE przekierowuje, gdy sesja istnieje", async () => {
    getSession.mockResolvedValueOnce({
      user: { name: "Test", email: "t@t.pl", role: "appraiser" },
    });
    render(await Page());
    expect(redirect).not.toHaveBeenCalled();
  });
});
