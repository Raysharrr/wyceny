import { describe, expect, it } from "vitest";
import {
  confirmProseSnapshot,
  mergeProseProposal,
  type ProseSnapshot,
} from "@/domain/prose-snapshot";
import { AUDIT_ACTIONS, applyProseConfirmation, applyProseProposal } from "@/domain/valuation";
import type { Valuation } from "@/ports/valuation";
import { approvableInput } from "./fixtures/valuation-inputs";

/**
 * Snapshot algebra for the operat's prose (ADR-014, FR-6, T6).
 *
 * Two rules carry legal weight here:
 *
 *  - **Regeneration never destroys the appraiser's work.** "Wygeneruj
 *    ponownie" replaces only sections whose provenance is still `ai` (or
 *    which are absent); a `rzeczoznawca`/`confirmed` section keeps ITS text
 *    and ITS provenance. Losing accepted text would be silent and
 *    irreversible, and the operat has legal effects.
 *  - **`sections` and `rejected` stay disjoint.** A section either carries
 *    text or carries the reason it has none — never both, or the step would
 *    show a rejection hint under a text the appraiser accepted.
 *
 * F-9: every address and number below is INVENTED (ul. Klonowa, m. Nowogród).
 */

const AI_TEXT = "Lokal o powierzchni 68,40 m2 obejmuje dwa pokoje z kuchnią.";
const HUMAN_TEXT = "Lokal obejmuje dwa pokoje, kuchnię w aneksie i łazienkę z WC.";

const previous: ProseSnapshot = {
  sections: {
    opis_lokalu: { value: HUMAN_TEXT, provenance: { source: "rzeczoznawca", status: "confirmed" } },
    otoczenie: {
      value: "Zabudowa wielorodzinna z lat 70.",
      provenance: { source: "ai", status: "to_verify" },
    },
  },
  rejected: { analiza_rynku: ["9 871,00"] },
  factsHash: "a".repeat(64),
  model: "claude-sonnet-5",
  generatedAt: "2026-08-01T09:00:00.000Z",
};

const incoming: ProseSnapshot = {
  sections: {
    opis_lokalu: { value: AI_TEXT, provenance: { source: "ai", status: "to_verify" } },
    otoczenie: {
      value: "Otoczenie stanowi zabudowa mieszkaniowa wielorodzinna.",
      provenance: { source: "ai", status: "to_verify" },
    },
    standard: {
      value: "Standard wykończenia przeciętny.",
      provenance: { source: "ai", status: "to_verify" },
    },
  },
  rejected: { uzasadnienie: [] },
  factsHash: "b".repeat(64),
  model: "claude-sonnet-5",
  generatedAt: "2026-08-18T07:30:00.000Z",
};

describe("mergeProseProposal — regeneration keeps the appraiser's text", () => {
  it("a confirmed section keeps its own text AND provenance", () => {
    const merged = mergeProseProposal(previous, incoming);

    expect(merged.sections.opis_lokalu).toEqual({
      value: HUMAN_TEXT,
      provenance: { source: "rzeczoznawca", status: "confirmed" },
    });
  });

  it("an ai section is replaced, and a section absent before is added", () => {
    const merged = mergeProseProposal(previous, incoming);

    expect(merged.sections.otoczenie).toEqual(incoming.sections.otoczenie);
    expect(merged.sections.standard).toEqual(incoming.sections.standard);
  });

  it("takes the INCOMING fingerprint, model and timestamp", () => {
    // Keeping the old factsHash while keeping the old text would make the
    // step permanently stale: every mount would fire (and pay for) a
    // generation whose result it then discards.
    const merged = mergeProseProposal(previous, incoming);

    expect(merged.factsHash).toBe(incoming.factsHash);
    expect(merged.model).toBe(incoming.model);
    expect(merged.generatedAt).toBe(incoming.generatedAt);
  });

  it("drops a rejection for a section the appraiser already wrote (disjointness)", () => {
    const merged = mergeProseProposal(previous, {
      ...incoming,
      sections: {},
      rejected: { opis_lokalu: ["1 234,00"], uzasadnienie: [] },
    });

    expect(merged.sections.opis_lokalu?.value).toBe(HUMAN_TEXT);
    expect(merged.rejected).toEqual({ uzasadnienie: [] });
  });

  it("a stale rejection from the previous run does not survive", () => {
    // analiza_rynku was rejected before; this run neither wrote nor rejected
    // it, so the old reason must not be shown next to the new proposals.
    const merged = mergeProseProposal(previous, incoming);

    expect(merged.rejected).toEqual({ uzasadnienie: [] });
  });

  it("no previous snapshot -> the incoming proposal verbatim", () => {
    expect(mergeProseProposal(null, incoming)).toEqual(incoming);
  });
});

describe("confirmProseSnapshot — the appraiser takes responsibility", () => {
  const meta = { factsHash: "c".repeat(64), now: new Date("2026-08-18T10:15:00.000Z") };

  it("every non-blank field becomes rzeczoznawca/confirmed", () => {
    const confirmed = confirmProseSnapshot(previous, { opis_lokalu: AI_TEXT }, meta);

    expect(confirmed.sections.opis_lokalu).toEqual({
      value: AI_TEXT,
      provenance: { source: "rzeczoznawca", status: "confirmed" },
    });
  });

  it("trims, and a whitespace-only field counts as blank", () => {
    const confirmed = confirmProseSnapshot(
      previous,
      { opis_lokalu: `  ${AI_TEXT}  `, otoczenie: "   " },
      meta,
    );

    expect(confirmed.sections.opis_lokalu?.value).toBe(AI_TEXT);
    expect(confirmed.sections.otoczenie).toBeUndefined();
  });

  it("a blank field REMOVES an ai proposal instead of silently keeping it", () => {
    // The appraiser deleted the generated text: the operat must not print it
    // anyway, and T7's gate must see an unfilled section.
    const confirmed = confirmProseSnapshot(previous, { otoczenie: "" }, meta);

    expect(confirmed.sections.otoczenie).toBeUndefined();
  });

  it("a section missing from the payload is treated as blank (the submit confirms the whole step)", () => {
    const confirmed = confirmProseSnapshot(previous, { opis_lokalu: HUMAN_TEXT }, meta);

    expect(Object.keys(confirmed.sections)).toEqual(["opis_lokalu"]);
  });

  it("after a confirm, no section is left with ai provenance", () => {
    const confirmed = confirmProseSnapshot(
      previous,
      {
        opis_lokalu: HUMAN_TEXT,
        otoczenie: "Otoczenie: zabudowa wielorodzinna.",
      },
      meta,
    );

    expect(
      Object.values(confirmed.sections).every((s) => s.provenance.source === "rzeczoznawca"),
    ).toBe(true);
  });

  it("a written section drops its rejection, a blank one keeps it", () => {
    const confirmed = confirmProseSnapshot(
      previous,
      { analiza_rynku: "Rynek lokalny wykazuje trend wzrostowy." },
      meta,
    );

    expect(confirmed.rejected).toEqual({});
    expect(confirmProseSnapshot(previous, {}, meta).rejected).toEqual({
      analiza_rynku: ["9 871,00"],
    });
  });

  it("keeps the generation's own fingerprint, model and timestamp", () => {
    const confirmed = confirmProseSnapshot(previous, { opis_lokalu: HUMAN_TEXT }, meta);

    expect(confirmed.factsHash).toBe(previous.factsHash);
    expect(confirmed.model).toBe(previous.model);
    expect(confirmed.generatedAt).toBe(previous.generatedAt);
  });

  it("hand-written prose with no generation behind it is born UP TO DATE", () => {
    // Otherwise a draft the appraiser wrote by hand would look stale on every
    // visit and keep triggering generations it does not need.
    const confirmed = confirmProseSnapshot(null, { opis_lokalu: HUMAN_TEXT }, meta);

    expect(confirmed.factsHash).toBe(meta.factsHash);
    expect(confirmed.model).toBe("");
    expect(confirmed.generatedAt).toBe("2026-08-18T10:15:00.000Z");
    expect(confirmed.rejected).toEqual({});
  });
});

const VID = "11111111-2222-3333-4444-555555555555";
const draft = (prose?: ProseSnapshot): Valuation =>
  ({
    id: VID,
    status: "in_progress",
    ownerId: "owner-1",
    wr: 512_000,
    inputs: { ...approvableInput("owner-1").inputs, prose },
  }) as unknown as Valuation;

describe("applyProseProposal / applyProseConfirmation (draft mutations)", () => {
  const meta = { factsHash: "d".repeat(64), now: new Date("2026-08-18T10:15:00.000Z") };

  it("a regeneration on a draft leaves the appraiser's confirmed section standing", () => {
    const v = applyProseProposal(draft(previous), incoming);

    expect(v.inputs!.prose!.sections.opis_lokalu?.value).toBe(HUMAN_TEXT);
    expect(v.inputs!.prose!.sections.otoczenie).toEqual(incoming.sections.otoczenie);
    expect(v.inputs!.prose!.factsHash).toBe(incoming.factsHash);
  });

  it("neither mutation NULLs wr — prose is render material, never an engine input (F-1)", () => {
    expect(applyProseProposal(draft(previous), incoming).wr).toBe(512_000);
    expect(applyProseConfirmation(draft(previous), { opis_lokalu: HUMAN_TEXT }, meta).wr).toBe(
      512_000,
    );
  });

  it("confirmation writes rzeczoznawca/confirmed onto the draft", () => {
    const v = applyProseConfirmation(
      draft(previous),
      { otoczenie: "Zabudowa wielorodzinna." },
      meta,
    );

    expect(v.inputs!.prose!.sections.otoczenie).toEqual({
      value: "Zabudowa wielorodzinna.",
      provenance: { source: "rzeczoznawca", status: "confirmed" },
    });
  });

  it("a frozen operat accepts neither a proposal nor a confirmation", () => {
    const approved = { ...draft(previous), status: "approved" } as Valuation;

    expect(() => applyProseProposal(approved, incoming)).toThrow();
    expect(() => applyProseConfirmation(approved, { opis_lokalu: HUMAN_TEXT }, meta)).toThrow();
  });

  it("AUDIT_ACTIONS gained prose_confirmed (FR-12 closed list)", () => {
    expect(AUDIT_ACTIONS).toContain("prose_confirmed");
    expect(AUDIT_ACTIONS).toHaveLength(15);
  });
});
