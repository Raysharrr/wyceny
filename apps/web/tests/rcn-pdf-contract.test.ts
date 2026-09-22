import { afterEach, describe, expect, it, vi } from "vitest";
import { httpRcnPdf } from "../src/adapters/rcn-pdf-http";
import { RcnPdfError } from "../src/ports/rcn-pdf";

/** Wire contract of the RCN converter adapter (T-22): multipart + token, refusal codes, schema. */
const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

const OK = {
  orderNumber: "GKG.GZW.4061.0000.2026",
  unit: "000000_0 - Przykładowo - obszar wiejski",
  count: 28,
  byKind: { lokale: 28, zabudowane: 0, niezabudowane: 0 },
  flaggedRows: 1,
  fileWarnings: ["lp_gap"],
  xlsxBase64: "UEsDBA==",
};

function mockFetch(body: unknown, status = 200) {
  const fn = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

function convert(
  bytes = new Uint8Array([37, 80, 68, 70]),
  name = "wydruk.pdf",
  type = "application/pdf",
) {
  return httpRcnPdf("http://w").convert({ bytes, name, type }, "tok");
}

describe("httpRcnPdf", () => {
  it("posts the PDF and token as multipart and returns the conversion", async () => {
    const fn = mockFetch(OK);
    await expect(convert()).resolves.toEqual(OK);
    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe("http://w/rcn-pdf-to-xlsx");
    expect(init.method).toBe("POST");
    const form = init.body as FormData;
    expect(form.get("token")).toBe("tok");
    const file = form.get("file") as File;
    expect(file.name).toBe("wydruk.pdf");
    expect(file.type).toBe("application/pdf");
  });

  it("nie przebiera pliku za PDF — inaczej worker nie może odpowiedzieć 415", async () => {
    const fn = mockFetch(OK);
    await convert(new Uint8Array([80, 75]), "rejestr.xlsx", "application/vnd.ms-excel");
    const file = (fn.mock.calls[0]![1].body as FormData).get("file") as File;
    expect(file.type).toBe("application/vnd.ms-excel");
    expect(file.name).toBe("rejestr.xlsx");
  });

  it("turns a 422 refusal into an RcnPdfError carrying its code", async () => {
    mockFetch({ detail: { code: "no_text_layer" } }, 422);
    const err = await convert().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RcnPdfError);
    expect((err as RcnPdfError).status).toBe(422);
    expect((err as RcnPdfError).code).toBe("no_text_layer");
  });

  it("a textual detail (413) leaves the code null — that is a call failure, not a file refusal", async () => {
    mockFetch({ detail: "Plik jest za duży (limit 4 MB i 400 stron)." }, 413);
    const err = await convert().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RcnPdfError);
    expect((err as RcnPdfError).status).toBe(413);
    expect((err as RcnPdfError).code).toBeNull();
  });

  it("an unknown 422 code is not smuggled through as a refusal", async () => {
    mockFetch({ detail: { code: "something_new" } }, 422);
    const err = (await convert().catch((e: unknown) => e)) as RcnPdfError;
    expect(err.code).toBeNull();
  });

  it("rejects a 200 that does not carry the workbook", async () => {
    const { xlsxBase64: _dropped, ...withoutFile } = OK;
    mockFetch(withoutFile);
    await expect(convert()).rejects.toThrow();
  });
});
