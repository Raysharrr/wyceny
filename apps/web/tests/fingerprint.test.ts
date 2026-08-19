import { describe, expect, it } from "vitest";
import { fingerprint } from "../src/lib/fingerprint";

describe("proposal fingerprint", () => {
  it("hashes every value — no plaintext may reach event_log", () => {
    const out = fingerprint({ street: "ul. Przykladowa 1", area: 54.2 });
    expect(out.street).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(out)).not.toContain("Przykladowa");
  });

  it("is stable, so unchanged means unchanged", () => {
    expect(fingerprint({ a: 1 }).a).toBe(fingerprint({ a: 1 }).a);
  });

  it("distinguishes an edited value", () => {
    expect(fingerprint({ a: 1 }).a).not.toBe(fingerprint({ a: 2 }).a);
  });

  it("skips absent fields rather than hashing the word 'null'", () => {
    expect(fingerprint({ a: null, b: undefined, c: 1 })).toEqual({
      c: fingerprint({ c: 1 }).c,
    });
  });

  it("does not collide between a number and its string form", () => {
    // JSON.stringify(1) is "1" and JSON.stringify("1") is "\"1\"" — the
    // quoting is what keeps 1 and "1" apart. Worth pinning: a metric that
    // called an edit "unchanged" because the form re-serialised a number as
    // text would be quietly wrong in the direction that flatters us.
    expect(fingerprint({ a: 1 }).a).not.toBe(fingerprint({ a: "1" }).a);
  });
});
