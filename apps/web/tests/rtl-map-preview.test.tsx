// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { valuationFormSchema } from "@/lib/valuation-form-schema";
import { EMPTY_SUBJECT } from "@/lib/subject-form";
import { SubjectSection, type MapPreviewState } from "@/app/valuations/new/subject-section";

// vitest doesn't expose globals, so @testing-library/react's afterEach
// auto-cleanup never registers — without this each render leaks into the
// next test's DOM (duplicate-element errors). Mirrors tests/rtl-kw-section.test.tsx.
afterEach(cleanup);

type FormInput = z.input<typeof valuationFormSchema>;
type FormOutput = z.output<typeof valuationFormSchema>;

// Presentation-only harness — SubjectSection in isolation, no network/parent
// logic. `mapPreview` is the prop under test (Task 8); the rest are the
// existing required props (Task 5).
function Harness({ mapPreview }: { mapPreview: MapPreviewState }) {
  const { control } = useForm<FormInput, unknown, FormOutput>({
    defaultValues: { subject: { ...EMPTY_SUBJECT } } as FormInput,
  });
  return (
    <SubjectSection
      control={control}
      fetchState={{ status: "idle" }}
      onRetry={() => {}}
      mapPreview={mapPreview}
    />
  );
}

describe("SubjectSection — map preview (Task 8)", () => {
  it("renders both map images with data: src and Polish captions when done", () => {
    render(
      <Harness
        mapPreview={{ status: "done", ewidencyjna: "ZVdpZHlmYWtl", orto: "b3J0b2Zha2U=" }}
      />,
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
    render(<Harness mapPreview={{ status: "unavailable", message: "Podgląd map niedostępny." }} />);
    expect(screen.getByText(/Podgląd map niedostępny\./)).toBeDefined();
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  it("renders no preview markup when idle", () => {
    render(<Harness mapPreview={{ status: "idle" }} />);
    expect(screen.queryByTestId("map-preview")).toBeNull();
  });
});
