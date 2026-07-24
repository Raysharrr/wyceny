// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { valuationFormSchema } from "@/lib/valuation-form-schema";
import { EMPTY_SUBJECT } from "@/lib/subject-form";
import {
  MapPreview,
  SubjectSection,
  type SubjectFetchState,
} from "@/app/valuations/new/subject-section";

// vitest doesn't expose globals, so @testing-library/react's afterEach
// auto-cleanup never registers — without this each render leaks into the
// next test's DOM (duplicate-element errors). Mirrors tests/rtl-kw-section.test.tsx.
afterEach(cleanup);

type FormInput = z.input<typeof valuationFormSchema>;
type FormOutput = z.output<typeof valuationFormSchema>;

// `MapPreview` is exported (Slice 12 Task 7, advisor I7) so `subject-form.tsx`
// can render it in the step-1 sidebar — tested here standalone, no RHF
// harness needed since it's a pure `state` -> markup component.
describe("MapPreview (Task 8, moved to the sidebar in Slice 12 Task 7)", () => {
  it("renders both map images with data: src and Polish captions when done", () => {
    render(
      <MapPreview state={{ status: "done", ewidencyjna: "ZVdpZHlmYWtl", orto: "b3J0b2Zha2U=" }} />,
    );
    const images = screen.getAllByRole("img");
    expect(images).toHaveLength(2);
    const ewidencyjna = screen.getByAltText("Mapa ewidencyjna działki") as HTMLImageElement;
    const orto = screen.getByAltText("Ortofotomapa okolicy") as HTMLImageElement;
    expect(ewidencyjna.src.startsWith("data:image/png;base64,")).toBe(true);
    expect(orto.src.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(screen.getByText("Mapa ewidencyjna (podgląd)")).toBeDefined();
    expect(screen.getByText("Ortofotomapa (podgląd)")).toBeDefined();
  });

  it("shows the unavailable message and renders zero images", () => {
    render(<MapPreview state={{ status: "unavailable", message: "Podgląd map niedostępny." }} />);
    expect(screen.getByText(/Podgląd map niedostępny\./)).toBeDefined();
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  it("renders no preview markup when idle", () => {
    render(<MapPreview state={{ status: "idle" }} />);
    expect(screen.queryByTestId("map-preview")).toBeNull();
  });
});

// Presentation-only harness — SubjectSection in isolation, no network/parent
// logic. `mapPreview` left SubjectSection's props in Task 7 (it no longer
// renders MapPreview itself); `fetchState`/`onRetry` stayed.
function FetchStatusHarness({ fetchState }: { fetchState: SubjectFetchState }) {
  const { control } = useForm<FormInput, unknown, FormOutput>({
    defaultValues: { subject: { ...EMPTY_SUBJECT } } as FormInput,
  });
  return <SubjectSection control={control} fetchState={fetchState} onRetry={() => {}} />;
}

describe("SubjectSection — fetch-status bar restyle (AutoBanner, Slice 12 Task 7)", () => {
  it("renders nothing when idle", () => {
    render(<FetchStatusHarness fetchState={{ status: "idle" }} />);
    expect(screen.queryByText(/Pobrano dane przedmiotu/)).toBeNull();
  });

  it("shows a neutral, non-banner message while loading", () => {
    const { container } = render(<FetchStatusHarness fetchState={{ status: "loading" }} />);
    expect(screen.getByText(/Pobieram dane działki i MPZP/)).toBeInTheDocument();
    expect(container.querySelector("[data-kind]")).toBeNull();
  });

  it("shows the info-kind AutoBanner with the fixed success copy when done", () => {
    const { container } = render(
      <FetchStatusHarness fetchState={{ status: "done", summary: "obręb Jeżyce, dz. 12" }} />,
    );
    expect(screen.getByText("Pobrano dane przedmiotu: EGiB, MPZP, geokoder")).toBeInTheDocument();
    expect(container.querySelector('[data-kind="info"]')).toBeInTheDocument();
  });

  // `outOfCoverage` documents itself (subject-section.tsx) as a deliberately
  // neutral, non-retryable info state — it must NOT get the amber warn
  // treatment reserved for the retryable `error` state.
  it("keeps outOfCoverage neutral, not a warning", () => {
    const { container } = render(
      <FetchStatusHarness
        fetchState={{ status: "outOfCoverage", message: "Adres poza zasięgiem." }}
      />,
    );
    expect(screen.getByText(/Adres poza zasięgiem\./)).toBeInTheDocument();
    expect(container.querySelector('[data-kind="warn"]')).toBeNull();
  });

  it("shows a warn-kind AutoBanner with a retry button on error", () => {
    const { container } = render(
      <FetchStatusHarness fetchState={{ status: "error", message: "Błąd pobierania." }} />,
    );
    expect(screen.getByText(/Błąd pobierania\./)).toBeInTheDocument();
    expect(container.querySelector('[data-kind="warn"]')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Spróbuj ponownie" })).toBeInTheDocument();
  });
});
