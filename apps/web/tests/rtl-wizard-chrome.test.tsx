// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { StepHeader } from "@/components/wizard/step-header";
import { FootNav } from "@/components/wizard/foot-nav";
import { AutoBanner } from "@/components/wizard/auto-banner";

afterEach(cleanup);

describe("StepHeader", () => {
  it("renders eyebrow, title, and description for step 3", () => {
    render(<StepHeader step={3} />);
    expect(screen.getByText("KROK 3/7 — DOBÓR PRÓBY TRANSAKCJI")).toBeInTheDocument();
    expect(screen.getByText("Próba porównawcza")).toBeInTheDocument();
    expect(
      screen.getByText("Pobierz transakcje z RCN i zbuduj próbę (min. 12)."),
    ).toBeInTheDocument();
  });

  it("renders eyebrow, title, and description for step 1", () => {
    render(<StepHeader step={1} />);
    expect(screen.getByText("KROK 1/7 — PRZEDMIOT WYCENY")).toBeInTheDocument();
    expect(screen.getByText("Dane przedmiotu")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Dane pobierane są automatycznie ze źródeł — zweryfikuj, uzupełnij braki; każde pole jest edytowalne.",
      ),
    ).toBeInTheDocument();
  });
});

describe("FootNav", () => {
  it("renders back link with default label 'Wstecz'", () => {
    render(
      <FootNav back={{ href: "/valuations" }}>
        <button>Zatwierdź</button>
      </FootNav>,
    );
    expect(screen.getByText(/Wstecz/)).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/valuations");
  });

  it("renders back link with custom label", () => {
    render(
      <FootNav back={{ href: "/valuations", label: "Powrót" }}>
        <button>Zatwierdź</button>
      </FootNav>,
    );
    expect(screen.getByText(/Powrót/)).toBeInTheDocument();
  });

  it("renders mid content", () => {
    render(
      <FootNav mid={<span>Próba: 12 transakcji</span>}>
        <button>Zatwierdź</button>
      </FootNav>,
    );
    expect(screen.getByText("Próba: 12 transakcji")).toBeInTheDocument();
  });

  it("renders children (primary action)", () => {
    render(
      <FootNav>
        <button>Zatwierdź próbę i dalej</button>
      </FootNav>,
    );
    expect(screen.getByRole("button", { name: /Zatwierdź próbę i dalej/ })).toBeInTheDocument();
  });
});

describe("AutoBanner", () => {
  it("renders children with info kind (default)", () => {
    render(<AutoBanner>Pobrano dane przedmiotu: EGiB, MPZP, geokoder</AutoBanner>);
    expect(screen.getByText("Pobrano dane przedmiotu: EGiB, MPZP, geokoder")).toBeInTheDocument();
    const banner = screen.getByText("Pobrano dane przedmiotu: EGiB, MPZP, geokoder").closest("div");
    expect(banner).toHaveAttribute("data-kind", "info");
  });

  it("renders children with warn kind and has amber classes", () => {
    const { container } = render(<AutoBanner kind="warn">Weryfikacja wymagana</AutoBanner>);
    expect(screen.getByText("Weryfikacja wymagana")).toBeInTheDocument();
    const banner = container.querySelector("[data-kind='warn']");
    expect(banner).toBeInTheDocument();
    expect(banner?.className).toContain("amber");
  });

  it("has data-kind attribute for testability", () => {
    const { container } = render(<AutoBanner kind="info">Test banner</AutoBanner>);
    const banner = container.querySelector("[data-kind='info']");
    expect(banner).toBeInTheDocument();
  });
});
