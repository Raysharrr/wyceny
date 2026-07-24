// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import { Topbar } from "@/components/topbar";

vi.mock("@/app/actions/sign-out", () => ({ signOutAction: vi.fn() }));

afterEach(cleanup);

describe("Topbar", () => {
  it("renders brand and logged-in user", () => {
    render(
      <Topbar userName="Zenon Dembski" userEmail="zenon@dembscy.pl" userRole="rzeczoznawca" />,
    );
    expect(screen.getByText("Wyceny")).toBeInTheDocument();
    expect(screen.getByText("Zenon Dembski")).toBeInTheDocument();
    expect(screen.getAllByText("rzeczoznawca").length).toBeGreaterThan(0);
  });

  it("is null-safe on an empty user name", () => {
    render(<Topbar userName="" userEmail="" userRole="rzeczoznawca" />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("opens the avatar dropdown on click, showing the session head, Profil i ustawienia, and Wyloguj", async () => {
    const user = userEvent.setup();
    render(
      <Topbar userName="Aneta Kowalska" userEmail="aneta@dembscy.pl" userRole="administrator" />,
    );

    expect(screen.queryByText("Profil i ustawienia")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Konto" }));

    expect(screen.getByText("aneta@dembscy.pl")).toBeInTheDocument();
    expect(screen.getByText("administrator · pełny dostęp")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /profil i ustawienia/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /wyloguj/i })).toBeInTheDocument();
    // The mockup's "Użytkownicy i role" item is deliberately omitted (no dead link — the screen doesn't exist).
    expect(screen.queryByText("Użytkownicy i role")).not.toBeInTheDocument();
  });
});
