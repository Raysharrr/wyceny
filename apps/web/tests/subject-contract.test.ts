import { afterEach, describe, expect, it, vi } from "vitest";
import { httpSubjectProposal, WORKER_SUBJECT_PREFIX } from "../src/adapters/subject-http";

const proposal = {
  parcel: {
    parcelId: "306401_1.0021.AR_10.161",
    obreb: "Jeżyce",
    arkusz: "10",
    nrDzialki: "161",
    powEwidHa: 0.0772,
    uzytek: "B",
  },
  building: { rodzaj: "budynki mieszkalne", kondygnacjeNadziemne: 6, kondygnacjePodziemne: 1 },
  mpzp: {
    symbol: "4MW/U",
    nazwaPlanu: "Testowo",
    uchwala: "VII/84/VIII/2019",
    dataUchwaly: "2019-02-26",
    publikator: "Rocznik 2019, poz. 2776",
  },
  meta: {
    x: 357604.98,
    y: 507623.88,
    teryt: "306401",
    fetchedAt: "2026-07-17T10:00:00Z",
    source: "geopoz-gugik",
    mpzpAbsent: false,
  },
};

afterEach(() => vi.unstubAllGlobals());

describe("httpSubjectProposal", () => {
  it("returns ok result on 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(proposal), { status: 200 })),
    );
    const result = await httpSubjectProposal("http://w").fetchSubject("Poznań, Kościelna 33");
    expect(result).toEqual({ kind: "ok", proposal });
  });

  it("passes through null EGiB fields unchanged (worker leaves them absent)", async () => {
    const proposalWithNulls = {
      ...proposal,
      parcel: { ...proposal.parcel, powEwidHa: null },
      building: { ...proposal.building, kondygnacjeNadziemne: null, kondygnacjePodziemne: null },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(proposalWithNulls), { status: 200 })),
    );
    const result = await httpSubjectProposal("http://w").fetchSubject("Poznań, Kościelna 33");
    expect(result).toEqual({ kind: "ok", proposal: proposalWithNulls });
  });

  it("maps 422 to outOfCoverage (non-retryable)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            detail: "Dane przedmiotu dostępne na razie dla Poznania — wpisz dane ręcznie.",
          }),
          { status: 422 },
        ),
      ),
    );
    const result = await httpSubjectProposal("http://w").fetchSubject("Warszawa, X 1");
    expect(result).toEqual({
      kind: "outOfCoverage",
      message: "Dane przedmiotu dostępne na razie dla Poznania — wpisz dane ręcznie.",
    });
  });

  it("maps 422 with non-JSON body to outOfCoverage with the fallback message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 422 })));
    const result = await httpSubjectProposal("http://w").fetchSubject("x");
    expect(result).toEqual({
      kind: "outOfCoverage",
      message: "Auto-pobieranie danych przedmiotu jest niedostępne dla tego adresu.",
    });
  });

  it("throws worker detail on 502 (retryable path)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            detail:
              "Nie udało się pobrać danych przedmiotu — spróbuj ponownie albo wpisz dane ręcznie.",
          }),
          { status: 502 },
        ),
      ),
    );
    await expect(httpSubjectProposal("http://w").fetchSubject("x")).rejects.toThrow(
      /Nie udało się pobrać danych przedmiotu/,
    );
  });

  it("throws prefixed error when body has no detail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 500 })));
    await expect(httpSubjectProposal("http://w").fetchSubject("x")).rejects.toThrow(
      new RegExp(`^${WORKER_SUBJECT_PREFIX}`),
    );
  });
});
