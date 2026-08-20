import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Focused unit test of `getAddressSuggestions` — mirrors
 * get-sample-proposal-action.test.ts. `_deps` is automocked so
 * `addressSuggest.suggest` is a controllable `vi.fn()`; `_record-failure`
 * is mocked so the F-13 assertion below can inspect exactly what would be
 * logged (the typed query must never appear there).
 */
vi.mock("@/auth/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "test-user", role: "appraiser" } })),
}));

vi.mock("@/app/valuations/_deps");

vi.mock("@/app/actions/_record-failure", () => ({
  recordEvent: vi.fn(async () => {}),
  recordFailure: vi.fn(async () => {}),
}));

import { getAddressSuggestions } from "../src/app/actions/get-address-suggestions";
import { addressSuggest } from "@/app/valuations/_deps";
import { recordEvent, recordFailure } from "@/app/actions/_record-failure";
import type { AddressSuggestion } from "@/ports/address-suggest";

const suggestMock = vi.mocked(addressSuggest.suggest);

const suggestions: AddressSuggestion[] = [
  {
    label: "Poznań, Sielawy",
    city: "Poznań",
    street: "Sielawy",
    number: null,
    teryt: "306401",
    inCoverage: true,
  },
];

describe("getAddressSuggestions", () => {
  beforeEach(() => {
    suggestMock.mockReset();
    vi.mocked(recordEvent).mockClear();
    vi.mocked(recordFailure).mockClear();
  });

  it("happy path — returns suggestions from the mocked adapter", async () => {
    suggestMock.mockResolvedValue(suggestions);
    const result = await getAddressSuggestions({ query: "Poznań, Siel" });
    expect(suggestMock).toHaveBeenCalledWith("Poznań, Siel");
    expect(result).toEqual({ suggestions });
  });

  it("logs only the count — the typed query never reaches a log (F-13)", async () => {
    suggestMock.mockResolvedValue(suggestions);
    await getAddressSuggestions({ query: "Poznań, Siel" });
    expect(recordEvent).toHaveBeenCalledTimes(1);
    const logged = vi.mocked(recordEvent).mock.calls[0][0];
    expect(logged.event).toBe("proposal.addressSuggest");
    expect(logged.meta).toEqual({ count: 1 });
    expect(JSON.stringify(logged)).not.toContain("Siel");
  });

  it("query shorter than 3 chars — empty list, adapter never called", async () => {
    const result = await getAddressSuggestions({ query: "Po" });
    expect(result).toEqual({ suggestions: [] });
    expect(suggestMock).not.toHaveBeenCalled();
  });

  it("defensive: an adapter throw collapses to an empty list, never propagates", async () => {
    suggestMock.mockRejectedValue(new Error("boom"));
    const result = await getAddressSuggestions({ query: "Poznań, Siel" });
    expect(result).toEqual({ suggestions: [] });
    expect(recordFailure).toHaveBeenCalledTimes(1);
  });
});
