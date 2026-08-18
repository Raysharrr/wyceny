import { describe, expect, it } from "vitest";
import {
  confirmProseSnapshot,
  mergeProseProposal,
  PROSE_SECTIONS,
  type ProseSection,
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
  factsHashes: { opis_lokalu: "a".repeat(64), otoczenie: "a".repeat(64) },
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
  factsHashes: { opis_lokalu: "b".repeat(64), otoczenie: "b".repeat(64), standard: "b".repeat(64) },
  model: "claude-sonnet-5",
  generatedAt: "2026-08-18T07:30:00.000Z",
};

describe("mergeProseProposal — regeneration keeps the appraiser's text", () => {
  it("a confirmed section keeps its own text and author", () => {
    const merged = mergeProseProposal(previous, incoming);

    expect(merged.sections.opis_lokalu?.value).toBe(HUMAN_TEXT);
    expect(merged.sections.opis_lokalu?.provenance.source).toBe("rzeczoznawca");
  });

  // Review finding I-A. The merge adopts the INCOMING per-section fingerprint
  // (see the test below for why it must), so a preserved text would inherit a
  // claim of being current that it has not earned: every character of it
  // predates the edit that changed the facts. That was a one-click,
  // full-price bypass of the F-4 staleness blocker — and the in-transaction
  // gate cannot see it, because the adapter recomputes the same hash and
  // finds the snapshot self-consistent.
  it("a confirmed section goes back to to_verify when the facts changed under it", () => {
    const merged = mergeProseProposal(previous, incoming);

    expect(previous.factsHashes.opis_lokalu).not.toBe(incoming.factsHashes.opis_lokalu);
    expect(merged.sections.opis_lokalu?.provenance.status).toBe("to_verify");
  });

  it("...and keeps its confirmed status when the facts did NOT change", () => {
    // opis_lokalu's incoming hash is set EQUAL to the previous one — present
    // on both sides, not merely absent from the incoming run — so this
    // exercises the real equality check, not the "this run never touched the
    // section" shortcut.
    const merged = mergeProseProposal(previous, {
      ...incoming,
      factsHashes: { ...incoming.factsHashes, opis_lokalu: previous.factsHashes.opis_lokalu },
    });

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

  it("sections take their INCOMING fingerprint (even a preserved confirmed one); model and timestamp always come from incoming", () => {
    // Keeping the old factsHashes entry while keeping the old text would make
    // that section permanently stale: every mount would fire (and pay for) a
    // generation whose result it then discards.
    const merged = mergeProseProposal(previous, incoming);

    expect(merged.factsHashes.opis_lokalu).toBe(incoming.factsHashes.opis_lokalu);
    expect(merged.factsHashes.otoczenie).toBe(incoming.factsHashes.otoczenie);
    expect(merged.factsHashes.standard).toBe(incoming.factsHashes.standard);
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

  it("fix round 1, finding 1: a legacy previous (no factsHashes map) does not throw", () => {
    // A row persisted before eb09bcf carries `factsHash: string` and no
    // per-section map at all — the type promises `factsHashes` is always
    // present, but an untyped jsonb round trip does not honour that.
    const legacy = {
      sections: {
        otoczenie: {
          value: "Zabudowa wielorodzinna z lat 70.",
          provenance: { source: "ai", status: "to_verify" },
        },
      },
      rejected: {},
      factsHash: "a".repeat(64),
      model: "claude-sonnet-5",
      generatedAt: "2026-01-01T00:00:00.000Z",
    } as unknown as ProseSnapshot;

    expect(() => mergeProseProposal(legacy, incoming)).not.toThrow();
  });

  it("fix round 2: a legacy-shaped incoming (no factsHashes map) does not throw either", () => {
    // The mirror of the previous test on the OTHER side of the merge — a
    // caller (e.g. a not-yet-migrated UI action) that builds `incoming`
    // without a `factsHashes` map must not crash the merge. This is exactly
    // the frame the T2 fix-round-2 review traced 3 unhandled rejections to
    // (rtl-step-descriptions.test.tsx, via step-descriptions.tsx's own
    // not-yet-migrated `generate()` — T5 territory, unrelated to this fix).
    const legacyIncoming = {
      sections: {
        otoczenie: {
          value: "Nowy tekst otoczenia.",
          provenance: { source: "ai", status: "to_verify" },
        },
      },
      rejected: {},
      factsHash: "f".repeat(64),
      model: "claude-sonnet-5",
      generatedAt: "2026-08-18T12:00:00.000Z",
    } as unknown as ProseSnapshot;

    expect(() => mergeProseProposal(previous, legacyIncoming)).not.toThrow();
  });

  it("fix round 1, finding 2: a partial regeneration (T3) leaves sections outside the batch untouched, byte-for-byte", () => {
    const allSix: ProseSnapshot = {
      sections: Object.fromEntries(
        PROSE_SECTIONS.map((s) => [
          s,
          {
            value: `Tekst sekcji ${s}.`,
            provenance: { source: "ai" as const, status: "to_verify" as const },
          },
        ]),
      ) as ProseSnapshot["sections"],
      rejected: {},
      factsHashes: Object.fromEntries(PROSE_SECTIONS.map((s) => [s, "a".repeat(64)])),
      model: "claude-sonnet-5",
      generatedAt: "2026-08-01T09:00:00.000Z",
    };
    // T3 regenerates only the STALE/requested sections — a batch of 2, not
    // all 6. The other 4 are simply absent from `incoming.sections` AND
    // `incoming.factsHashes`, exactly as a partial proposal looks.
    const partial: ProseSnapshot = {
      sections: {
        analiza_rynku: {
          value: "Nowy tekst analiza_rynku.",
          provenance: { source: "ai", status: "to_verify" },
        },
        uzasadnienie: {
          value: "Nowy tekst uzasadnienie.",
          provenance: { source: "ai", status: "to_verify" },
        },
      },
      rejected: {},
      factsHashes: { analiza_rynku: "e".repeat(64), uzasadnienie: "e".repeat(64) },
      model: "claude-sonnet-5",
      generatedAt: "2026-08-18T12:00:00.000Z",
    };

    const merged = mergeProseProposal(allSix, partial);

    const untouched: ProseSection[] = ["opis_lokalu", "otoczenie", "zagospodarowanie", "standard"];
    for (const section of untouched) {
      expect(merged.sections[section]).toEqual(allSix.sections[section]);
      expect(merged.factsHashes[section]).toBe(allSix.factsHashes[section]);
    }
    expect(merged.sections.analiza_rynku).toEqual(partial.sections.analiza_rynku);
    expect(merged.sections.uzasadnienie).toEqual(partial.sections.uzasadnienie);
  });
});

describe("confirmProseSnapshot — the appraiser takes responsibility", () => {
  const meta = {
    factsHashes: {
      opis_lokalu: "c".repeat(64),
      otoczenie: "c".repeat(64),
      analiza_rynku: "c".repeat(64),
    },
    now: new Date("2026-08-18T10:15:00.000Z"),
  };

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

  it("stamps the CURRENT fingerprint — the appraiser accepted the text against today's facts", () => {
    // T7 redefinition (T6 review, I-2): `factsHashes` records, per section,
    // the facts the text was last ACCEPTED AGAINST, not only the ones it was
    // generated from. The F-4 gate blocks prose whose fingerprint no longer
    // matches the draft, and re-reading the text on step 6 has to be a way
    // out of that — otherwise the only remedy would be a paid regeneration.
    // `model` and `generatedAt` still describe the generation and are
    // untouched.
    const confirmed = confirmProseSnapshot(previous, { opis_lokalu: HUMAN_TEXT }, meta);

    expect(confirmed.factsHashes.opis_lokalu).toBe(meta.factsHashes.opis_lokalu);
    expect(confirmed.factsHashes.opis_lokalu).not.toBe(previous.factsHashes.opis_lokalu);
    expect(confirmed.model).toBe(previous.model);
    expect(confirmed.generatedAt).toBe(previous.generatedAt);
  });

  it("hand-written prose with no generation behind it is born UP TO DATE", () => {
    // Otherwise a draft the appraiser wrote by hand would look stale on every
    // visit and keep triggering generations it does not need.
    const confirmed = confirmProseSnapshot(null, { opis_lokalu: HUMAN_TEXT }, meta);

    expect(confirmed.factsHashes.opis_lokalu).toBe(meta.factsHashes.opis_lokalu);
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
  const meta = {
    factsHashes: { opis_lokalu: "d".repeat(64), otoczenie: "d".repeat(64) },
    now: new Date("2026-08-18T10:15:00.000Z"),
  };

  it("a regeneration on a draft leaves the appraiser's confirmed section standing", () => {
    const v = applyProseProposal(draft(previous), incoming);

    expect(v.inputs!.prose!.sections.opis_lokalu?.value).toBe(HUMAN_TEXT);
    expect(v.inputs!.prose!.sections.otoczenie).toEqual(incoming.sections.otoczenie);
    expect(v.inputs!.prose!.factsHashes.otoczenie).toBe(incoming.factsHashes.otoczenie);
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
