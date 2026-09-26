import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ksiegaTrescMigawkiSchema,
  ksiegaTrescSchema,
  kwTranscribeResponseSchema,
} from "@/domain/kw-tresc";
import { transcribeKw } from "@/lib/kw-transcribe-client";

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

const GRUNT_FIXTURE = path.join(
  process.cwd(),
  "..",
  "worker",
  "tests",
  "fixtures",
  "kw_transcribe_grunt_sample.json",
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
    expect(tresc.zakres).toBe("pelna");
    expect(ksiegaTrescMigawkiSchema.parse(tresc)).toEqual(tresc);
  });

  it.each([
    ["lokal", "pelna", WORKER_FIXTURE],
    ["grunt", "przedmiotowy_lokal", GRUNT_FIXTURE],
  ] as const)("fikstura %s: odpowiedź 1:1 ze schematem, zakres %s", (_karta, zakres, plik) => {
    const wire = JSON.parse(readFileSync(plik, "utf8"));
    expect(kwTranscribeResponseSchema.parse(wire)).toEqual(wire);
    expect(wire.zakres).toBe(zakres);
  });

  it("odpowiedź bez `zakres` to drift kontraktu (F-S1)", () => {
    const { zakres, ...bez } = workerSample();
    expect(zakres).toBeDefined();
    expect(kwTranscribeResponseSchema.safeParse(bez).success).toBe(false);
  });

  it("schemat modelu nie zna `zakres` — o zakresie nie decyduje model", () => {
    const { walidacja, ...tresc } = workerSample();
    expect(walidacja).toBeDefined();
    expect(ksiegaTrescSchema.parse(tresc)).not.toHaveProperty("zakres");
  });

  it("migawka sprzed ADR-024 (bez `zakres`) nadal się parsuje", () => {
    const { walidacja, zakres, ...stara } = workerSample();
    expect([walidacja, zakres].every(Boolean)).toBe(true);
    expect(ksiegaTrescMigawkiSchema.parse(stara)).toEqual(stara);
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

describe("transcribeKw — multipart: files[] i/lub tekst, karta, klucze; nigdy stare `file`", () => {
  afterEach(() => vi.unstubAllGlobals());

  function przechwycFetch() {
    const calls: FormData[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push(init.body as FormData);
        return new Response(JSON.stringify(workerSample()), { status: 200 });
      }),
    );
    return calls;
  }

  it("trzy PDF-y idą jako powtarzane pole `files`", async () => {
    const calls = przechwycFetch();
    const pdf = (n: string) => new File(["%PDF-1.4"], n, { type: "application/pdf" });
    const wynik = await transcribeKw({
      files: [pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf")],
      token: "t",
      workerUrl: "http://w",
      karta: "lokal",
    });
    expect(wynik.kind).toBe("ok");
    expect(calls[0].getAll("files")).toHaveLength(3);
    expect(calls[0].get("file")).toBeNull();
    expect(calls[0].get("tekst")).toBeNull();
    expect(calls[0].get("token")).toBe("t");
  });

  it("tekst idzie jako pole `tekst`, bez plików", async () => {
    const calls = przechwycFetch();
    await transcribeKw({
      tekst: "DZIAŁ I-O - OZNACZENIE NIERUCHOMOŚCI\nUlica | TESTOWA | 1",
      token: "t",
      workerUrl: "http://w",
      karta: "lokal",
    });
    expect(calls[0].getAll("files")).toHaveLength(0);
    expect(calls[0].get("tekst")).toContain("Ulica | TESTOWA | 1");
  });

  // Kontrakt ADR-024 §3.1: `karta` wymagana zawsze (bez niej worker odpowiada
  // 422), klucze wyłącznie podane, a `nr_lokalu` wyłącznie niepusty — pusty
  // string byłby dla workera „numerem lokalu", którego nie ma w żadnym wierszu.
  it("karta jedzie zawsze; klucze tylko podane, nr lokalu tylko niepusty", async () => {
    const calls = przechwycFetch();
    await transcribeKw({ tekst: "x", token: "t", workerUrl: "http://w", karta: "lokal" });
    expect(calls[0].get("karta")).toBe("lokal");
    expect(calls[0].get("kw_lokalu")).toBeNull();
    expect(calls[0].get("nr_lokalu")).toBeNull();
    await transcribeKw({
      tekst: "x",
      token: "t",
      workerUrl: "http://w",
      karta: "grunt",
      klucze: { kwLokalu: "KW-A", nrLokalu: "24" },
    });
    expect(calls[1].get("karta")).toBe("grunt");
    expect(calls[1].get("kw_lokalu")).toBe("KW-A");
    expect(calls[1].get("nr_lokalu")).toBe("24");
    await transcribeKw({
      tekst: "x",
      token: "t",
      workerUrl: "http://w",
      karta: "grunt",
      klucze: { kwLokalu: "KW-A", nrLokalu: null },
    });
    expect(calls[2].get("kw_lokalu")).toBe("KW-A");
    expect(calls[2].get("nr_lokalu")).toBeNull();
    await transcribeKw({
      tekst: "x",
      token: "t",
      workerUrl: "http://w",
      karta: "grunt",
      klucze: null,
    });
    expect(calls[3].get("karta")).toBe("grunt");
    expect(calls[3].get("kw_lokalu")).toBeNull();
    expect(calls[3].get("nr_lokalu")).toBeNull();
  });

  it("413 (worker: tekst za długi, bez echa treści) i 422 bez kodu zapadają w klasę ogólną", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 413 })),
    );
    expect(
      await transcribeKw({ tekst: "x", token: "t", workerUrl: "http://w", karta: "lokal" }),
    ).toEqual({
      kind: "error",
      code: "kw_transkrypcja_blad",
    });
  });
});
