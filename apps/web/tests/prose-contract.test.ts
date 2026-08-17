import { describe, expect, it, vi } from "vitest";
import { httpProseProposal, PROSE_WORKER_RESPONDED_PREFIX } from "@/adapters/prose-http";

/**
 * Wire contract for the worker's `POST /prose-proposal` (T3).
 *
 * F-9: the facts below are invented (ul. Klonowa, m. Nowogród).
 */

const REQUEST = {
  token: "1780000000.abc123.deadbeef",
  sections: ["analiza_rynku", "opis_lokalu"] as const,
  facts: {
    adres: "ul. Klonowa 14/3, Nowogród",
    pow_uzytkowa: "68,40",
    rynek: "wtórny, lokale mieszkalne",
    proba: {
      liczba_transakcji: 3,
      cena_min_zl_m2: "9 240,00",
      cena_srednia_zl_m2: "10 815,00",
      cena_max_zl_m2: "12 480,00",
    },
  },
  transactions: [{ data: "11-2024", cena_m2: 9240 }],
};

function mockFetch(response: Record<string, unknown>) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  global.fetch = fetchMock as any;
  return fetchMock;
}

describe("PortProseProposal contract", () => {
  it("posts the Polish wire shape and maps the response back to camelCase usage", async () => {
    const fetchMock = mockFetch({
      ok: true,
      json: async () => ({
        sekcje: { opis_lokalu: "Lokal o powierzchni 68,40 m2 składa się z dwóch pokoi." },
        odrzucone: { analiza_rynku: ["9 871,00"] },
        model: "claude-sonnet-5",
        usage: { input_tokens: 3120, output_tokens: 480 },
      }),
    });

    const port = httpProseProposal("http://worker.test");
    const result = await port.fetchProposal({ ...REQUEST, sections: [...REQUEST.sections] });

    expect(fetchMock).toHaveBeenCalledWith("http://worker.test/prose-proposal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: REQUEST.token,
        sekcje: ["analiza_rynku", "opis_lokalu"],
        fakty: REQUEST.facts,
        transakcje: REQUEST.transactions,
      }),
    });
    expect(result).toEqual({
      sections: { opis_lokalu: "Lokal o powierzchni 68,40 m2 składa się z dwóch pokoi." },
      rejected: { analiza_rynku: ["9 871,00"] },
      model: "claude-sonnet-5",
      usage: { inputTokens: 3120, outputTokens: 480 },
    });
  });

  it("502: the worker's Polish detail reaches the caller verbatim", async () => {
    mockFetch({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      json: async () => ({ detail: "Nie udało się wygenerować opisów — spróbuj ponownie." }),
    });

    const port = httpProseProposal("http://worker.test");
    await expect(
      port.fetchProposal({ ...REQUEST, sections: [...REQUEST.sections] }),
    ).rejects.toThrow("Nie udało się wygenerować opisów — spróbuj ponownie.");
  });

  it("400: the worker's Polish detail reaches the caller verbatim", async () => {
    mockFetch({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({ detail: "Nie wskazano żadnej sekcji do wygenerowania." }),
    });

    const port = httpProseProposal("http://worker.test");
    await expect(
      port.fetchProposal({ ...REQUEST, sections: [...REQUEST.sections] }),
    ).rejects.toThrow("Nie wskazano żadnej sekcji do wygenerowania.");
  });

  it("422: pydantic returns `detail` as a LIST — no [object Object] in the message", async () => {
    mockFetch({
      ok: false,
      status: 422,
      statusText: "Unprocessable Entity",
      json: async () => ({
        detail: [
          {
            type: "float_parsing",
            loc: ["body", "transakcje", 0, "cena_m2"],
            msg: "Input should be a valid number",
          },
        ],
      }),
    });

    const port = httpProseProposal("http://worker.test");
    const error = await port
      .fetchProposal({ ...REQUEST, sections: [...REQUEST.sections] })
      .catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("[object Object]");
    expect((error as Error).message).toContain(PROSE_WORKER_RESPONDED_PREFIX);
    expect((error as Error).message).toContain("422");
  });

  it("no JSON body at all: falls back to the status line", async () => {
    mockFetch({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => {
        throw new Error("not json");
      },
    });

    const port = httpProseProposal("http://worker.test");
    await expect(
      port.fetchProposal({ ...REQUEST, sections: [...REQUEST.sections] }),
    ).rejects.toThrow(/500.*Internal Server Error/);
  });
});
