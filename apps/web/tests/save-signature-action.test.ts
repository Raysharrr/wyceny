import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Focused unit test of `saveSignature`'s own guards (final review, Important
 * #2): the three validation branches (missing/empty file, disallowed MIME,
 * oversized file) plus the happy path and the repository-failure path (Fix
 * 1 — wrapping `profileRepository.saveSignature` in try/catch).
 *
 * `_deps` is automocked (mirrors approve-valuation-action.test.ts /
 * create-valuation-action.test.ts) so `profileRepository.saveSignature`
 * becomes a controllable `vi.fn()` and no real Postgres call ever leaves the
 * test process. `@/auth/session` and `next/cache`/`next/navigation` are
 * mocked the same way those files do.
 */
vi.mock("@/auth/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "u1", role: "appraiser" } })),
}));

vi.mock("@/app/valuations/_deps");

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

import { saveSignature } from "../src/app/actions/save-signature";
import { profileRepository } from "@/app/valuations/_deps";

const saveSignatureMock = vi.mocked(profileRepository.saveSignature);

function formDataWith(file?: File): FormData {
  const formData = new FormData();
  if (file) {
    formData.append("signature", file);
  }
  return formData;
}

describe("saveSignature — action guards", () => {
  beforeEach(() => {
    saveSignatureMock.mockReset();
  });

  it("rejects a missing file", async () => {
    const result = await saveSignature(formDataWith());

    expect(result?.error).toMatch(/wybierz plik/i);
    expect(saveSignatureMock).not.toHaveBeenCalled();
  });

  it("rejects an empty file", async () => {
    const empty = new File([], "sig.png", { type: "image/png" });

    const result = await saveSignature(formDataWith(empty));

    expect(result?.error).toMatch(/wybierz plik/i);
    expect(saveSignatureMock).not.toHaveBeenCalled();
  });

  it("rejects a disallowed MIME type", async () => {
    const gif = new File(["gif-bytes"], "sig.gif", { type: "image/gif" });

    const result = await saveSignature(formDataWith(gif));

    expect(result?.error).toMatch(/dozwolone formaty/i);
    expect(saveSignatureMock).not.toHaveBeenCalled();
  });

  it("rejects a file over 1 MB", async () => {
    const big = new File([Buffer.alloc(1_000_001)], "sig.png", { type: "image/png" });

    const result = await saveSignature(formDataWith(big));

    expect(result?.error).toMatch(/za duży/i);
    expect(saveSignatureMock).not.toHaveBeenCalled();
  });

  it("saves a valid PNG and returns no error", async () => {
    saveSignatureMock.mockResolvedValueOnce(undefined);
    const png = new File([Buffer.from("small-png-bytes")], "sig.png", { type: "image/png" });

    const result = await saveSignature(formDataWith(png));

    expect(result).toBeUndefined();
    expect(saveSignatureMock).toHaveBeenCalledWith("u1", expect.any(Buffer), "image/png");
  });

  it("surfaces a Polish error when the repository write fails (Fix 1)", async () => {
    saveSignatureMock.mockRejectedValueOnce(new Error("db unreachable"));
    const png = new File([Buffer.from("small-png-bytes")], "sig.png", { type: "image/png" });

    const result = await saveSignature(formDataWith(png));

    expect(result?.error).toMatch(/nie udało się zapisać/i);
  });
});
