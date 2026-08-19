import { describe, expect, it, vi } from "vitest";

vi.mock("@/auth/session", () => ({
  getSession: async () => ({ user: { id: "u1", role: "appraiser" } }),
}));
vi.mock("@/app/valuations/_deps", () => ({
  valuationRepository: {
    confirmSample: async () => {
      throw new Error("worker unreachable");
    },
  },
  eventLog: { record: async () => {} },
}));

describe("a failing action", () => {
  it("hands the appraiser a code to read back over the phone", async () => {
    const { confirmSample } = await import("../src/app/actions/confirm-sample");
    const result = await confirmSample("11111111-1111-1111-1111-111111111111");
    expect(result?.error).toMatch(/\(kod: [0-9a-f]{8}\)$/);
  });

  it("keeps the Polish sentence in front of the code", async () => {
    const { confirmSample } = await import("../src/app/actions/confirm-sample");
    const result = await confirmSample("11111111-1111-1111-1111-111111111111");
    expect(result?.error).toMatch(/^Nie udało się potwierdzić próby/);
  });
});
