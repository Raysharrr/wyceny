// @vitest-environment jsdom
/**
 * `SampleRanges` w izolacji — zachowanie, którego nie widać przez `StepSample`:
 * co się dzieje z polem, w którym rzeczoznawca WŁAŚNIE pisze, gdy w tle wraca
 * przeliczony dobór. Złapane na żywo 2026-08-23: wpisana „cena do" znikała,
 * bo powrót reselectu przemontowywał całą grupę pól.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { SampleRanges } from "../src/app/valuations/[id]/steps/sample-ranges";

afterEach(cleanup);

const renderRanges = (props: Partial<Parameters<typeof SampleRanges>[0]> = {}) =>
  render(
    <SampleRanges
      areaRange={undefined}
      unitPriceRange={undefined}
      busy={false}
      disabledReason={null}
      onCommit={vi.fn()}
      {...props}
    />,
  );

describe("SampleRanges", () => {
  it("nowy snapshot NIE kasuje wartości wpisywanej w polu z fokusem", async () => {
    const user = userEvent.setup();
    const { rerender } = renderRanges();

    // Rzeczoznawca zatwierdził „cena od", przeszedł do „cena do" i pisze…
    await user.click(screen.getByLabelText(/cena do/i));
    await user.keyboard("13000");

    // …a w tym momencie wraca przeliczony dobór z zatwierdzoną „ceną od".
    rerender(
      <SampleRanges
        areaRange={undefined}
        unitPriceRange={{ min: 10000 }}
        busy={false}
        disabledReason={null}
        onCommit={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/cena do/i)).toHaveValue(13000);
    expect(screen.getByLabelText(/cena od/i)).toHaveValue(10000);
  });

  it("przeliczanie NIE blokuje pól — blokada zabierała fokus i zjadała wpisywane znaki", () => {
    // Znalezione na żywo 2026-08-23: `disabled` w trakcie reselectu odbiera
    // polu fokus, więc dosynchronizowanie przestaje je omijać i kasuje to, co
    // rzeczoznawca właśnie wpisał. jsdom nie odtwarza tego bluru, więc test
    // pilnuje przyczyny (brak blokady), a nie objawu.
    renderRanges({ busy: true });
    expect(screen.getByLabelText(/cena do/i)).not.toBeDisabled();
    expect(screen.getByLabelText(/powierzchnia od/i)).not.toBeDisabled();
  });

  it("brak zapamiętanej puli blokuje pola — przeliczyć i tak nie ma z czego", () => {
    renderRanges({ disabledReason: "Pobierz próbę ponownie." });
    expect(screen.getByLabelText(/cena do/i)).toBeDisabled();
  });

  it("pola bez fokusu przyjmują wartości z nowego snapshotu", () => {
    const { rerender } = renderRanges();
    rerender(
      <SampleRanges
        areaRange={{ min: 40, max: 60 }}
        unitPriceRange={undefined}
        busy={false}
        disabledReason={null}
        onCommit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/powierzchnia od/i)).toHaveValue(40);
    expect(screen.getByLabelText(/powierzchnia do/i)).toHaveValue(60);
  });

  it("zatwierdza dopiero na wyjściu z pola i tylko przy realnej zmianie", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    renderRanges({ unitPriceRange: { min: 10000 }, onCommit });

    // Wejście i wyjście bez zmiany — nic do przeliczenia.
    await user.click(screen.getByLabelText(/cena od/i));
    await user.tab();
    expect(onCommit).not.toHaveBeenCalled();

    await user.click(screen.getByLabelText(/cena do/i));
    await user.keyboard("13000");
    await user.tab();
    expect(onCommit).toHaveBeenCalledWith({
      areaRange: undefined,
      unitPriceRange: { min: 10000, max: 13000 },
    });
  });
});
