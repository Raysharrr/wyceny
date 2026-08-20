// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddressSuggestInput } from "../src/components/wizard/address-suggest-input";
import type { AddressSuggestion } from "../src/ports/address-suggest";

const SUGGESTIONS: AddressSuggestion[] = [
  {
    label: "Poznań, Sielawy",
    city: "Poznań",
    street: "Sielawy",
    number: null,
    teryt: "306401",
  },
  {
    label: "Poznań, Sielska",
    city: "Poznań",
    street: "Sielska",
    number: null,
    teryt: "306401",
  },
];

function Harness({
  fetchSuggestions,
  onBlur = () => {},
  rerenderSignal = 0,
}: {
  fetchSuggestions: (query: string) => Promise<{ suggestions: AddressSuggestion[] }>;
  onBlur?: () => void;
  /** Bump to force an unrelated parent re-render (mirrors subjectFetch/kwState churn). */
  rerenderSignal?: number;
}) {
  const [value, setValue] = useState("");
  // rerenderSignal is intentionally unused in the JSX: a bump re-renders the
  // Harness, which recreates the inline fetchSuggestions closure below — the
  // exact churn subject-form.tsx produces on subjectFetch/kwState updates.
  void rerenderSignal;
  return (
    <AddressSuggestInput
      id="address"
      name="address"
      placeholder="np. ul. Wierzbięcice 12/4, Poznań"
      value={value}
      onValueChange={setValue}
      onBlur={onBlur}
      // Inline arrow ON PURPOSE — production (subject-form.tsx) passes a fresh
      // closure every render, and the review's probes showed a stable
      // reference here makes the suite green for the wrong reason (I-4).
      fetchSuggestions={(query) => fetchSuggestions(query)}
      debounceMs={0}
    />
  );
}

const focusAndType = (el: Element, value: string) => {
  fireEvent.focus(el);
  fireEvent.change(el, { target: { value } });
};

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("AddressSuggestInput", () => {
  it("shows suggestions after typing 3+ chars, with no coverage caveat", async () => {
    const fetchMock = vi.fn(async () => ({ suggestions: SUGGESTIONS }));
    render(<Harness fetchSuggestions={fetchMock} />);

    focusAndType(screen.getByRole("combobox"), "Siel");

    const listbox = await screen.findByRole("listbox");
    expect(listbox).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("Siel");
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain("Poznań, Sielawy");
    expect(options[1].textContent).toContain("Poznań, Sielska");
    // Coverage is filtered on the worker — the list never carries a caveat.
    for (const option of options) expect(option.textContent).not.toContain("spoza Poznania");
  });

  it("keeps the listbox closed when the worker returns no suggestions", async () => {
    // Out-of-coverage input is filtered on the worker, so an empty list is now the
    // normal path for non-Poznań addresses — it must look like a plain text field.
    const fetchMock = vi.fn(async () => ({ suggestions: [] }));
    render(<Harness fetchSuggestions={fetchMock} />);

    focusAndType(screen.getByRole("combobox"), "Kórnik, Pozn");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("Kórnik, Pozn"));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("combobox").getAttribute("aria-expanded")).toBe("false");
  });

  it("does not fetch below 3 characters", async () => {
    const fetchMock = vi.fn(async () => ({ suggestions: SUGGESTIONS }));
    render(<Harness fetchSuggestions={fetchMock} />);

    focusAndType(screen.getByRole("combobox"), "Si");
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("keyboard: ArrowDown + Enter inserts the canonical label and closes the list", async () => {
    const fetchMock = vi.fn(async () => ({ suggestions: SUGGESTIONS }));
    render(<Harness fetchSuggestions={fetchMock} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;

    focusAndType(input, "Siel");
    await screen.findByRole("listbox");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(input.value).toBe("Poznań, Sielawy");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  it("mouse: clicking an option inserts its label without firing the field blur", async () => {
    const onBlur = vi.fn();
    const fetchMock = vi.fn(async () => ({ suggestions: SUGGESTIONS }));
    render(<Harness fetchSuggestions={fetchMock} onBlur={onBlur} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;

    focusAndType(input, "Siel");
    await screen.findByRole("listbox");

    const option = screen.getAllByRole("option")[0];
    fireEvent.mouseDown(option);
    fireEvent.click(option);

    expect(input.value).toBe("Poznań, Sielawy");
    expect(onBlur).not.toHaveBeenCalled();
  });

  it("selection does not immediately re-open the list with a follow-up fetch", async () => {
    const fetchMock = vi.fn(async () => ({ suggestions: SUGGESTIONS }));
    render(<Harness fetchSuggestions={fetchMock} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;

    focusAndType(input, "Siel");
    await screen.findByRole("listbox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    await new Promise((r) => setTimeout(r, 30));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Escape closes the list and leaves the typed value intact", async () => {
    const fetchMock = vi.fn(async () => ({ suggestions: SUGGESTIONS }));
    render(<Harness fetchSuggestions={fetchMock} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;

    focusAndType(input, "Siel");
    await screen.findByRole("listbox");
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input.value).toBe("Siel");
  });

  it("NEXT_PUBLIC_ADDRESS_SUGGEST=off disables fetching entirely", async () => {
    vi.stubEnv("NEXT_PUBLIC_ADDRESS_SUGGEST", "off");
    const fetchMock = vi.fn(async () => ({ suggestions: SUGGESTIONS }));
    render(<Harness fetchSuggestions={fetchMock} />);

    focusAndType(screen.getByRole("combobox"), "Sielawy");
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("I-1: blur cancels the pending debounce — no fetch, no ghost list", async () => {
    const fetchMock = vi.fn(async () => ({ suggestions: SUGGESTIONS }));
    const { rerender } = render(<Harness fetchSuggestions={fetchMock} rerenderSignal={0} />);
    const input = screen.getByRole("combobox");

    focusAndType(input, "Siel");
    fireEvent.blur(input);
    // Parent keeps re-rendering after blur (subjectFetch state churn in prod).
    rerender(<Harness fetchSuggestions={fetchMock} rerenderSignal={1} />);
    await new Promise((r) => setTimeout(r, 30));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("I-1: a response landing after blur never opens the list over a left field", async () => {
    let resolveFetch!: (v: { suggestions: AddressSuggestion[] }) => void;
    const fetchMock = vi.fn(
      () => new Promise<{ suggestions: AddressSuggestion[] }>((r) => (resolveFetch = r)),
    );
    render(<Harness fetchSuggestions={fetchMock} />);
    const input = screen.getByRole("combobox");

    focusAndType(input, "Siel");
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.blur(input);
    resolveFetch({ suggestions: SUGGESTIONS });
    await new Promise((r) => setTimeout(r, 10));

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("I-3: an unrelated parent re-render after selection does not refetch nor reopen", async () => {
    const fetchMock = vi.fn(async () => ({ suggestions: SUGGESTIONS }));
    const { rerender } = render(<Harness fetchSuggestions={fetchMock} rerenderSignal={0} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;

    focusAndType(input, "Siel");
    await screen.findByRole("listbox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("Poznań, Sielawy");

    rerender(<Harness fetchSuggestions={fetchMock} rerenderSignal={1} />);
    rerender(<Harness fetchSuggestions={fetchMock} rerenderSignal={2} />);
    await new Promise((r) => setTimeout(r, 30));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("M-6: Enter with no active option is passed through to the form", async () => {
    const fetchMock = vi.fn(async () => ({ suggestions: SUGGESTIONS }));
    render(<Harness fetchSuggestions={fetchMock} />);
    const input = screen.getByRole("combobox");

    focusAndType(input, "Siel");
    await screen.findByRole("listbox");

    // fireEvent returns false when preventDefault was called — submit must
    // stay possible while no suggestion is highlighted.
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(true);
  });

  it("stale responses lose: only the latest query's suggestions render", async () => {
    let resolveFirst!: (v: { suggestions: AddressSuggestion[] }) => void;
    const fetchMock = vi
      .fn<(query: string) => Promise<{ suggestions: AddressSuggestion[] }>>()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockImplementationOnce(async () => ({ suggestions: [SUGGESTIONS[0]] }));
    render(<Harness fetchSuggestions={fetchMock} />);
    const input = screen.getByRole("combobox");

    focusAndType(input, "Siel");
    await new Promise((r) => setTimeout(r, 10));
    focusAndType(input, "Sielawy");
    await screen.findByRole("listbox");

    // The slow first response arrives last — it must NOT overwrite the list.
    resolveFirst({ suggestions: SUGGESTIONS });
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });
});
