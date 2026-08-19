import { afterEach, describe, expect, it, vi } from "vitest";
import { httpMapImages } from "../src/adapters/maps-http";
import { httpProseProposal } from "../src/adapters/prose-http";
import { httpSampleProposal } from "../src/adapters/sample-http";
import { httpSubjectProposal } from "../src/adapters/subject-http";
import { httpWorker } from "../src/adapters/worker-http";
import { withTrace } from "../src/lib/trace";
import type { ProseProposalRequest } from "../src/ports/prose";

/**
 * Every call the web makes to the worker carries the run's trace id.
 *
 * One adapter left out is not a partial win: that call's failure lands in the
 * worker's log with an id nothing joins, and `pnpm trace` shows a run with a
 * hole where the interesting part was. Hence all five adapters — six fetch
 * sites, since the worker port has two — are pinned here, and each also
 * asserts its existing `Content-Type` survived, because the failure mode of a
 * careless edit is replacing the headers object rather than merging into it.
 *
 * F-9: the addresses below are invented.
 */

const TRACE_ID = /^[0-9a-f]{8}$/;
const BASE = "http://worker.test";

const PROSE_REQUEST: ProseProposalRequest = {
  token: "1780000000.abc123.deadbeef",
  sections: ["opis_lokalu"],
  facts: {
    adres: "ul. Testowa 1, Nowogród",
    pow_uzytkowa: "54,20",
    rynek: "wtórny, lokale mieszkalne",
  },
  transactions: [],
};

const PROSE_BODY = {
  sekcje: {},
  odrzucone: {},
  model: "m",
  usage: { input_tokens: 1, output_tokens: 1 },
};

const ADAPTER_CALLS = [
  {
    name: "worker /amount-in-words",
    body: { words: "sto złotych" },
    contentType: "application/json",
    call: async () => {
      await httpWorker(BASE).amountInWords(100);
    },
  },
  {
    name: "worker /convert-to-pdf",
    body: {},
    contentType: "officedocument",
    call: async () => {
      await httpWorker(BASE).convertToPdf(Buffer.from("PK-fake-docx"));
    },
  },
  {
    name: "worker /sample-proposal",
    body: { transactions: [], meta: {} },
    contentType: "application/json",
    call: async () => {
      await httpSampleProposal(BASE).fetchProposal("ul. Testowa 1, Nowogród", 54.2);
    },
  },
  {
    name: "worker /subject-proposal",
    body: { parcel: {}, building: null, mpzp: null, meta: {} },
    contentType: "application/json",
    call: async () => {
      await httpSubjectProposal(BASE).fetchSubject("ul. Testowa 1, Nowogród");
    },
  },
  {
    name: "worker /prose-proposal",
    body: PROSE_BODY,
    contentType: "application/json",
    call: async () => {
      await httpProseProposal(BASE).fetchProposal(PROSE_REQUEST);
    },
  },
  {
    name: "worker /map-proposal",
    body: { ewidencyjna: "", orto: "" },
    contentType: "application/json",
    call: async () => {
      await httpMapImages(BASE).fetchMaps("ul. Testowa 1, Nowogród");
    },
  },
];

function stubFetch(body: unknown) {
  const fetchMock = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify(body), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentHeaders(fetchMock: ReturnType<typeof stubFetch>): Record<string, string> {
  return (fetchMock.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
}

afterEach(() => vi.unstubAllGlobals());

describe("worker adapters", () => {
  it.each(ADAPTER_CALLS)(
    "$name sends the ambient traceId as X-Request-Id",
    async ({ body, contentType, call }) => {
      const fetchMock = stubFetch(body);

      await withTrace(call);

      const headers = sentHeaders(fetchMock);
      expect(headers["X-Request-Id"]).toMatch(TRACE_ID);
      expect(headers["Content-Type"]).toContain(contentType);
    },
  );

  it("sends no X-Request-Id outside a traced run, rather than a bogus one", async () => {
    const fetchMock = stubFetch(PROSE_BODY);

    await httpProseProposal(BASE).fetchProposal(PROSE_REQUEST);

    expect(sentHeaders(fetchMock)).not.toHaveProperty("X-Request-Id");
  });
});
