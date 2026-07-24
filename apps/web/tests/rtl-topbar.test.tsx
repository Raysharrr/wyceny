// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { Topbar } from "@/components/topbar";

afterEach(cleanup);

describe("Topbar", () => {
  it("renders brand and logged-in user", () => {
    render(<Topbar userName="Zenon Dembski" userRole="rzeczoznawca" />);
    expect(screen.getByText("Wyceny")).toBeInTheDocument();
    expect(screen.getByText("Zenon Dembski")).toBeInTheDocument();
    expect(screen.getByText("rzeczoznawca")).toBeInTheDocument();
  });

  it("is null-safe on an empty user name", () => {
    render(<Topbar userName="" userRole="rzeczoznawca" />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("renders children (e.g. Profil link / Wyloguj form) provided by the layout", () => {
    render(
      <Topbar userName="Aneta Kowalska" userRole="administrator">
        <span>Profil</span>
      </Topbar>,
    );
    expect(screen.getByText("Profil")).toBeInTheDocument();
  });
});
