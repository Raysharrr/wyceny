// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const redirect = vi.fn();
// Unlike `redirect`, this mock THROWS. The real `notFound()` never returns,
// and a bare `vi.fn()` would let execution fall through to `page.load()` on
// `undefined` — the test would then pass on a TypeError instead of on the
// guard it claims to check.
const NOT_FOUND = new Error("NEXT_NOT_FOUND");
const notFound = vi.fn(() => {
  throw NOT_FOUND;
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
  notFound: () => notFound(),
}));

const getSession = vi.fn();
vi.mock("@/auth/session", () => ({ getSession: () => getSession() }));

import Page, { generateStaticParams } from "@/app/pomoc/[slug]/page";
import { HELP_PAGES } from "@/content/pomoc/manifest";

// vitest doesn't expose globals, so RTL's auto-cleanup never registers.
afterEach(cleanup);
// Module-scope mocks: without clearing, call counts leak between tests and
// the "did NOT redirect" assertion below would fail spuriously.
beforeEach(() => vi.clearAllMocks());

const session = { user: { name: "Test", email: "t@t.pl", role: "appraiser" } };
const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

describe("/pomoc/[slug]", () => {
  it("przekierowuje na login bez sesji", async () => {
    getSession.mockResolvedValueOnce(null);
    await Page(params("pierwsze-kroki"));
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  // The mutation an independent review caught in Task 1: because the mocked
  // `redirect` doesn't throw, an UNCONDITIONAL `redirect("/login")` — a page
  // nobody can open — satisfies the test above. This is the other half.
  it("NIE przekierowuje, gdy sesja istnieje", async () => {
    getSession.mockResolvedValueOnce(session);
    render(await Page(params("pierwsze-kroki")));
    expect(redirect).not.toHaveBeenCalled();
  });

  it("renderuje tytul i tresc strony z manifestu", async () => {
    getSession.mockResolvedValueOnce(session);
    render(await Page(params("pierwsze-kroki")));
    expect(screen.getByRole("heading", { name: "Pierwsze kroki", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /zanim zaczniesz/i })).toBeInTheDocument();
  });

  it("zglasza 404 dla sluga spoza manifestu", async () => {
    getSession.mockResolvedValueOnce(session);
    await expect(Page(params("nie-ma-takiej"))).rejects.toThrow(NOT_FOUND);
    expect(notFound).toHaveBeenCalled();
  });

  it("generateStaticParams wylicza slugi z manifestu", async () => {
    expect(await generateStaticParams()).toEqual(HELP_PAGES.map(({ slug }) => ({ slug })));
  });
});
