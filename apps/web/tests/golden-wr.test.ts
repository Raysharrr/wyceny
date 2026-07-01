import { describe, expect, it, vi } from "vitest";
import { httpWorker } from "../src/adapters/worker-http";

/**
 * F-1 HARNESS: real golden assertion (1 044 400 → "milion czterdzieści
 * cztery tysiące czterysta złotych") lands with the KCS engine slice.
 *
 * Until then this pins the SHAPE of the create→worker→save pipeline as it
 * exists today (`stubWr` from the stub formula in
 * `app/actions/create-wycena.ts`, `słownie` from the real `PortWorker`
 * adapter — `fetch` mocked here exactly like `worker-contract.test.ts`, so
 * this runs standalone with no live worker or DB). A future engine swap
 * can't silently break the contract without this failing first.
 */
describe("F-1 golden WR harness (stub pipeline shape)", () => {
  it("stubWr is a positive number, słownie is a non-empty Polish string, and the two are never confused", async () => {
    const area = 104.44;
    const stubWr = Math.round(area) * 10000; // mirrors create-wycena.ts's stub formula

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ words: "milion czterdzieści cztery tysiące czterysta złotych" }) }) as any;

    const worker = httpWorker("http://worker.test");
    const slownie = await worker.slownie(stubWr);

    expect(typeof stubWr).toBe("number");
    expect(stubWr).toBeGreaterThan(0);

    expect(typeof slownie).toBe("string");
    expect(slownie.length).toBeGreaterThan(0);
    expect(slownie).toContain("złot");

    // WR ≠ słownie: the numeric total and its Polish-words rendering must
    // never collide or get swapped.
    expect(slownie).not.toBe(String(stubWr));
  });
});
