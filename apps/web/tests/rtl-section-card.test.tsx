// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MapPin } from "lucide-react";
import { SectionCard } from "@/components/wizard/section-card";

afterEach(cleanup);

describe("SectionCard", () => {
  it("renders the title, sub, icon, right slot, and children", () => {
    render(
      <SectionCard
        icon={MapPin}
        title="Adres i lokalizacja"
        sub="1 pole"
        right={<span>Badge</span>}
      >
        <p>Zawartość karty</p>
      </SectionCard>,
    );
    expect(
      screen.getByRole("heading", { name: "Adres i lokalizacja", level: 3 }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 pole")).toBeInTheDocument();
    expect(screen.getByText("Badge")).toBeInTheDocument();
    expect(screen.getByText("Zawartość karty")).toBeInTheDocument();
  });

  it("omits sub, right, and icon when not provided", () => {
    render(
      <SectionCard title="Dane przedmiotu">
        <p>Zawartość</p>
      </SectionCard>,
    );
    expect(screen.getByRole("heading", { name: "Dane przedmiotu" })).toBeInTheDocument();
    expect(screen.queryByText("Badge")).not.toBeInTheDocument();
  });
});
