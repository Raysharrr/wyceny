import { describe, it, expect } from "vitest";
import { memoryStorage } from "../src/adapters/storage-memory";

describe("PortStorage — in-memory adapter", () => {
  it("put() stores content and returns a URL; get() round-trips the content", async () => {
    const storage = memoryStorage();
    const content = "<stub operat content>";

    const url = await storage.put("doc-1", content);
    expect(url).toBe("/api/docs/doc-1");

    const buf = await storage.get("doc-1");
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString()).toBe(content);
  });

  it("get() on a missing key rejects", async () => {
    const storage = memoryStorage();
    await expect(storage.get("does-not-exist")).rejects.toThrow();
  });
});
