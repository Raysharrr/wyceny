// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const redirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));

const getSession = vi.fn();
vi.mock("@/auth/session", () => ({ getSession: () => getSession() }));

import Page from "../page";

afterEach(cleanup);

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
});
