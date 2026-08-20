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
    inCoverage: true,
  },
  {
    label: "Kórnik, Sielska",
    city: "Kórnik",
    street: "Sielska",
    number: null,
    teryt: "302109",
    inCoverage: false,
  },
];

function Harness({
  fetchSuggestions,
  onBlur = () => {},
}: {
  fetchSuggestions: (query: string) => Promise<{ suggestions: AddressSuggestion[] }>;
  onBlur?: () => void;
}) {
  const [value, setValue] = useState("");
  return (
    <AddressSuggestInput
      id="address"
      name="address"
      placeholder="np. ul. Wierzbięcice 12/4, Poznań"
      value={value}
      onValueChange={setValue}
      onBlur={onBlur}
      fetchSuggestions={fetchSuggestions}
      debounceMs={0}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("AddressSuggestInput", () => {
  it("shows suggestions after typing 3+ chars and marks out-of-coverage ones", async () => {
    const fetchMock = vi.fn(async () => ({ suggestions: SUGGESTIONS }));
    render(<Harness fetchSuggestions={fetchMock} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Siel" } });

    const listbox = await screen.findByRole("listbox");
    expect(listbox).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("Siel");
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain("Poznań, Sielawy");
    expect(options[1].textContent).toContain("poza pokryciem MVP");
    expect(options[0].textContent).not.toContain("poza pokryciem MVP");
  });

  it("does not fetch below 3 characters", async () => {
    const fetchMock = vi.fn(async () => ({ suggestions: SUGGESTIONS }));
    render(<Harness fetchSuggestions={fetchMock} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Si" } });
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("keyboard: ArrowDown + Enter inserts the canonical label and closes the list", async () => {
    const fetchMock = vi.fn(async () => ({ suggestions: SUGGESTIONS }));
    render(<Harness fetchSuggestions={fetchMock} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "Siel" } });
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

    fireEvent.change(input, { target: { value: "Siel" } });
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

    fireEvent.change(input, { target: { value: "Siel" } });
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

    fireEvent.change(input, { target: { value: "Siel" } });
    await screen.findByRole("listbox");
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input.value).toBe("Siel");
  });

  it("NEXT_PUBLIC_ADDRESS_SUGGEST=off disables fetching entirely", async () => {
    vi.stubEnv("NEXT_PUBLIC_ADDRESS_SUGGEST", "off");
    const fetchMock = vi.fn(async () => ({ suggestions: SUGGESTIONS }));
    render(<Harness fetchSuggestions={fetchMock} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Sielawy" } });
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stale responses lose: only the latest query's suggestions render", async () => {
    let resolveFirst!: (v: { suggestions: AddressSuggestion[] }) => void;
    const fetchMock = vi
      .fn<(query: string) => Promise<{ suggestions: AddressSuggestion[] }>>()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockImplementationOnce(async () => ({ suggestions: [SUGGESTIONS[0]] }));
    render(<Harness fetchSuggestions={fetchMock} />);
    const input = screen.getByRole("combobox");

    fireEvent.change(input, { target: { value: "Siel" } });
    await new Promise((r) => setTimeout(r, 10));
    fireEvent.change(input, { target: { value: "Sielawy" } });
    await screen.findByRole("listbox");

    // The slow first response arrives last — it must NOT overwrite the list.
    resolveFirst({ suggestions: SUGGESTIONS });
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });
});
