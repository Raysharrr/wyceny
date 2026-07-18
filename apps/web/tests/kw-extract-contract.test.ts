import { afterEach, describe, expect, it, vi } from "vitest";
import { extractKw } from "@/lib/kw-extract-client";

const WIRE_OK = {
  extract: {
    docType: "akt",
    kwLokalu: "AB1C/1/9",
    kwGruntu: "AB1C/2/7",
    kwInne: [],
    deweloperski: false,
    powUzytkowaKw: 69.56,
    powPrzezOdwolanie: false,
    udzial: "1234/56789",
    sad: "Sąd Rejonowy",
    wydzial: "VI Wydział Ksiąg Wieczystych",
    dataDokumentu: "2026-05-11",
    dzial3: { wpisy: false, tresc: [] },
    dzial4: { wpisy: true, tresc: ["hipoteka umowna — Bank Przykładowy S.A., 350000 zł"] },
  },
  docTypeDetected: "akt",
  typeMismatch: false,
  model: "claude-sonnet-5",
};

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

const args = {
  file: new File([new Uint8Array([37, 80, 68, 70])], "akt.pdf", { type: "application/pdf" }),
  expectedType: "akt" as const,
  token: "1.2.3",
  workerUrl: "http://worker.test",
};

describe("extractKw contract", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps a 200 into KwSnapshot + meta", async () => {
    mockFetch(200, WIRE_OK);
    const result = await extractKw(args);
    if (result.kind !== "ok") throw new Error(result.kind);
    expect(result.extract.source).toBe("akt");
    expect(result.extract.powUzytkowaKw).toBe(69.56);
    expect(result.extract.dzial4?.tresc[0]).toContain("Bank Przykładowy");
    expect(result.meta.docTypeDeclared).toBe("akt");
    expect(result.typeMismatch).toBe(false);
  });

  it("422 -> invalidDoc with the worker's Polish detail", async () => {
    mockFetch(422, { detail: "To nie wygląda na akt notarialny ani odpis księgi wieczystej." });
    const result = await extractKw(args);
    expect(result.kind).toBe("invalidDoc");
  });

  it("502 -> retryable error; 401 -> non-retryable error", async () => {
    mockFetch(502, { detail: "Nie udało się odczytać dokumentu — spróbuj ponownie." });
    const r502 = await extractKw(args);
    expect(r502).toMatchObject({ kind: "error", retryable: true });
    mockFetch(401, { detail: "Nieprawidłowy lub wygasły token." });
    const r401 = await extractKw(args);
    expect(r401).toMatchObject({ kind: "error", retryable: false });
  });

  it("malformed 200 body -> retryable error (zod guard)", async () => {
    mockFetch(200, { nonsense: true });
    const result = await extractKw(args);
    expect(result.kind).toBe("error");
  });
});
