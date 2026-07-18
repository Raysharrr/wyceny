import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth/session", () => ({ getSession: async () => ({ user: "tester" }) }));

import { mintKwUploadToken } from "@/app/actions/mint-kw-token";

describe("mintKwUploadToken", () => {
  beforeEach(() => {
    process.env.WORKER_SHARED_SECRET = "test-secret";
  });

  it("mints exp.nonce.sig with a valid HMAC and ~5 min expiry", async () => {
    const result = await mintKwUploadToken();
    if ("error" in result) throw new Error(result.error);
    const [exp, nonce, sig] = result.token.split(".");
    const expected = createHmac("sha256", "test-secret").update(`${exp}.${nonce}`).digest("hex");
    expect(sig).toBe(expected);
    const ttl = Number(exp) - Math.floor(Date.now() / 1000);
    expect(ttl).toBeGreaterThan(250);
    expect(ttl).toBeLessThanOrEqual(300);
  });

  it("returns a Polish error when the secret is unset", async () => {
    delete process.env.WORKER_SHARED_SECRET;
    const result = await mintKwUploadToken();
    expect(result).toHaveProperty("error");
  });
});
