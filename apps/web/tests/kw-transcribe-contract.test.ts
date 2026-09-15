import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ksiegaTrescSchema, kwTranscribeResponseSchema } from "@/domain/kw-tresc";

// The worker's own fixture — the same file its endpoint test asserts the wire
// shape against — read in place, never copied (it is the synthetic book with
// fictional persons, excluded from check-no-pii.sh by path).
const WORKER_FIXTURE = path.join(
  process.cwd(),
  "..",
  "worker",
  "tests",
  "fixtures",
  "kw_transcribe_sample.json",
);

function workerSample(): Record<string, unknown> {
  return JSON.parse(readFileSync(WORKER_FIXTURE, "utf8"));
}

describe("kw-transcribe contract (worker fixture ↔ KsiegaTresc)", () => {
  it("parses the worker's 200 body without dropping a single key", () => {
    const wire = workerSample();
    const parsed = kwTranscribeResponseSchema.parse(wire);
    // Deep equality after zod's default key stripping = shapes match 1:1.
    expect(parsed).toEqual(wire);
    expect(parsed.dzialy.map((d) => d.kod)).toEqual(["I-O", "I-Sp", "II", "III", "IV"]);
    expect(parsed.walidacja).toEqual({ ok: true, bledy: [] });
  });

  it("KsiegaTresc is the content without the verdict (what inputs.kw.tresc stores)", () => {
    const { walidacja, ...tresc } = workerSample();
    expect(walidacja).toBeDefined();
    expect(ksiegaTrescSchema.parse(tresc)).toEqual(tresc);
  });

  it("an error with and without a section parses; a value-free class is a plain string", () => {
    const wire = {
      ...workerSample(),
      walidacja: {
        ok: false,
        bledy: [{ klasa: "pole_niezgodne:kwGruntu" }, { klasa: "pesel_suma", dzial: "II" }],
      },
    };
    expect(kwTranscribeResponseSchema.parse(wire).walidacja.bledy).toEqual([
      { klasa: "pole_niezgodne:kwGruntu" },
      { klasa: "pesel_suma", dzial: "II" },
    ]);
  });

  it("rejects a drifted shape: unknown section code, missing polaDodatkowe", () => {
    const wire = workerSample() as { dzialy: { kod: string }[] };
    const badKod = { ...wire, dzialy: [{ ...wire.dzialy[0], kod: "V" }] };
    expect(kwTranscribeResponseSchema.safeParse(badKod).success).toBe(false);
    const { polaDodatkowe, ...withoutPola } = workerSample();
    expect(polaDodatkowe).toBeDefined();
    expect(ksiegaTrescSchema.safeParse(withoutPola).success).toBe(false);
  });
});
