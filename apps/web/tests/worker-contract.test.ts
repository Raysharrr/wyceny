import { describe, it, expect, vi } from "vitest";
import { httpWorker } from "../src/adapters/worker-http";

describe("PortWorker contract (F-11)", () => {
  it("returns words string, not the WR number", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ words: "milion czterdzieści cztery tysiące czterysta złotych" }) }) as any;
    const w = httpWorker("http://worker.test");
    const res = await w.amountInWords(1044400);
    expect(typeof res).toBe("string");
    expect(res).not.toBe("1044400");
    expect(res).toContain("złot");
  });

  it("rejects when the worker responds with a non-2xx status, instead of persisting an undefined amountInWords", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "Internal Server Error", json: async () => ({ detail: "boom" }) }) as any;
    const w = httpWorker("http://worker.test");
    await expect(w.amountInWords(1044400)).rejects.toThrow();
  });
});
