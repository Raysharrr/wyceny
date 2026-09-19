import { beforeEach, describe, expect, it, vi } from "vitest";
import { RcnPdfError, type RcnConversion } from "../src/ports/rcn-pdf";

/**
 * `convertRcnPdf` (T-22): session → token → port, and the map from a worker
 * refusal to the Polish sentence the screen shows verbatim (spec §7.4). A
 * refused FILE is not a failure of the app, so it must not land in the event
 * log — only genuine breakage does.
 */
const state = vi.hoisted(() => ({
  session: { user: { id: "u-1", role: "appraiser" } } as unknown,
  token: "tok" as string | null,
}));

const redirected = vi.hoisted(() => vi.fn());
const convert = vi.hoisted(() => vi.fn());
const recordFailure = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirected(path);
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("@/auth/session", () => ({
  getSession: vi.fn(async () => state.session),
}));
vi.mock("@/app/valuations/_deps", () => ({ rcnPdf: { convert } }));
vi.mock("@/lib/worker-token", () => ({ mintWorkerToken: () => state.token }));
vi.mock("@/app/actions/_record-failure", () => ({ recordFailure }));

const { convertRcnPdf } = await import("../src/app/actions/rcn-pdf");

const RESULT: RcnConversion = {
  orderNumber: "GKG.GZW.4061.0000.2026",
  unit: "000000_0 - Przykładowo - obszar wiejski",
  count: 28,
  flaggedRows: 1,
  fileWarnings: [],
  xlsxBase64: "UEsDBA==",
};

function form(file?: File) {
  const fd = new FormData();
  if (file) fd.set("file", file);
  return fd;
}

const pdf = () =>
  new File([new Uint8Array([37, 80, 68, 70])], "wydruk.pdf", { type: "application/pdf" });

beforeEach(() => {
  vi.clearAllMocks();
  state.session = { user: { id: "u-1", role: "appraiser" } };
  state.token = "tok";
  convert.mockResolvedValue(RESULT);
});

describe("convertRcnPdf", () => {
  it("sends an unauthenticated caller to the login screen", async () => {
    state.session = null;
    await expect(convertRcnPdf(form(pdf()))).rejects.toThrow("NEXT_REDIRECT");
    expect(redirected).toHaveBeenCalledWith("/login");
  });

  it("asks for a file when none came with the form", async () => {
    expect(await convertRcnPdf(form())).toEqual({ error: "Wybierz plik PDF." });
    expect(convert).not.toHaveBeenCalled();
  });

  it("says so when the shared secret is missing instead of calling the worker", async () => {
    state.token = null;
    expect(await convertRcnPdf(form(pdf()))).toEqual({
      error: "Narzędzie nie jest skonfigurowane — skontaktuj się z administratorem.",
    });
    expect(convert).not.toHaveBeenCalled();
  });

  it("passes the bytes and the token through and returns the conversion", async () => {
    expect(await convertRcnPdf(form(pdf()))).toEqual({ result: RESULT });
    const [file, token] = convert.mock.calls[0]!;
    expect(token).toBe("tok");
    expect(file.name).toBe("wydruk.pdf");
    expect(Array.from(file.bytes as Uint8Array)).toEqual([37, 80, 68, 70]);
    expect(file.type).toBe("application/pdf");
  });

  it("podaje prawdziwy typ pliku, żeby worker mógł odmówić 415 na nie-PDF", async () => {
    const xlsx = new File([new Uint8Array([80, 75])], "rejestr.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    convert.mockRejectedValue(new RcnPdfError(415, null));
    expect(await convertRcnPdf(form(xlsx))).toEqual({ error: "To nie jest plik PDF." });
    expect(convert.mock.calls[0]![0].type).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });

  it.each([
    [
      "no_text_layer",
      "To jest skan — plik nie ma warstwy tekstowej. Pobierz wydruk z portalu jako PDF, nie skanuj wydruku papierowego.",
    ],
    [
      "not_rcn_printout",
      "Nie rozpoznaję tego układu. Narzędzie czyta wydruki „WYDRUK Z RCN” z portalu GEO-INFO i.Rzeczoznawca — wgraj PDF pobrany z zakładki Zamówienia.",
    ],
    ["no_transactions", "W pliku nie ma żadnej transakcji."],
  ] as const)(
    "turns the %s refusal into its sentence, without recording a failure",
    async (code, text) => {
      convert.mockRejectedValue(new RcnPdfError(422, code));
      expect(await convertRcnPdf(form(pdf()))).toEqual({ error: text });
      expect(recordFailure).not.toHaveBeenCalled();
    },
  );

  it.each([
    // R4: one 413 covers both worker limits, so the sentence names both.
    [413, "Plik jest za duży (limit 4 MB i 400 stron)."],
    [415, "To nie jest plik PDF."],
  ])(
    "maps status %i to its own sentence, and it is still a statement about the FILE — no failure recorded",
    async (status, text) => {
      convert.mockRejectedValue(new RcnPdfError(status, null));
      expect(await convertRcnPdf(form(pdf()))).toEqual({ error: text });
      // R3: "za duży" and "to nie PDF" are verdicts on the upload, not outages.
      expect(recordFailure).not.toHaveBeenCalled();
    },
  );

  it("any other breakage is the fallback sentence AND a recorded failure", async () => {
    convert.mockRejectedValue(new Error("fetch failed"));
    expect(await convertRcnPdf(form(pdf()))).toEqual({
      error: "Nie udało się przetworzyć pliku. Spróbuj ponownie.",
    });
    expect(recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ event: "rcn_pdf.failed", actorId: "u-1" }),
    );
  });
});
