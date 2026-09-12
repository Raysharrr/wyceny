import { describe, expect, it, vi } from "vitest";

/**
 * The ONE switch on the kind of right in the "Prawo spółdzielcze" block
 * (spec §4.2, S3): `_deps.ts` picks the register behind step 3. The
 * composition root touches the DB client at import time, so it is mocked —
 * adapters only capture their arguments when constructed.
 */
vi.mock("@/db/client", () => ({ db: {}, pool: {} }));

import { coopSampleProposal, sampleProposal, sampleProposalFor } from "../src/app/valuations/_deps";

describe("sampleProposalFor", () => {
  it("wlasnosc_lokalu → RCN adapter; spoldzielcze_wlasnosciowe → coop register adapter", () => {
    expect(sampleProposalFor("wlasnosc_lokalu")).toBe(sampleProposal);
    expect(sampleProposalFor("spoldzielcze_wlasnosciowe")).toBe(coopSampleProposal);
    expect(coopSampleProposal).not.toBe(sampleProposal);
  });
});
