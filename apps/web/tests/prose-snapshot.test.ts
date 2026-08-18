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
 *  - **A rejection never disappears next to text that survived it.** For an
 *    appraiser's own text, `sections` and `rejected` stay disjoint — no
 *    rejection reason is ever attached, because the appraiser's text was
 *    never at risk of being replaced. For carried-forward `ai` text, the two
 *    are NOT disjoint (T3 ruling 2): a section re-requested because its
 *    facts moved, then rejected by the worker's number guard, keeps its old
 *    text AND the reason it could not be refreshed — otherwise a failed
 *    regeneration looks identical to a section nobody ever asked about.
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
    expect(merged.rejected.opis_lokalu).toBeUndefined();
    expect(merged.rejected.uzasadnienie).toEqual([]);
  });

  it("a rejection is superseded when THIS run asked about the section again", () => {
    // analiza_rynku was rejected before, and this run re-requested it: it
    // carries a fresh fingerprint and came back with text. Whatever the old
    // reason said, it no longer describes this snapshot.
    const merged = mergeProseProposal(previous, {
      ...incoming,
      sections: {
        ...incoming.sections,
        analiza_rynku: {
          value: "Rynek lokalny obejmuje transakcje z lat 2024-2025.",
          provenance: { source: "ai", status: "to_verify" },
        },
      },
      factsHashes: { ...incoming.factsHashes, analiza_rynku: "b".repeat(64) },
    });

    expect(merged.rejected).toEqual({ uzasadnienie: [] });
  });

  it("...but it SURVIVES a partial regeneration that never asked about it (T5)", () => {
    // The mirror of the case above, and the one T3's partial batch created:
    // `incoming` carries no text, no reason and no fingerprint for
    // analiza_rynku, so this run never touched it. The box is still empty for
    // exactly the reason recorded before — dropping it downgrades a named
    // refusal ("9 871,00") to the generic "nie udało się" shrug, on a section
    // nothing re-attempted. Reachable only since step 6 lets the appraiser
    // regenerate a chosen subset (T5).
    const merged = mergeProseProposal(previous, incoming);

    expect(merged.rejected).toEqual({ analiza_rynku: ["9 871,00"], uzasadnienie: [] });
  });

  // T3 ruling 2. otoczenie is AI-authored (not the appraiser's), carried
  // forward from a PRIOR successful generation. This run re-requests it —
  // its facts moved — and the worker's number guard rejects the fresh
  // attempt: no `incoming.sections.otoczenie`, but a reason in
  // `incoming.rejected.otoczenie`. Before this fix, `&& !kept` silently
  // dropped that reason whenever carried-forward text existed to fall back
  // to: the appraiser clicks "Wygeneruj ponownie", the text on screen does
  // not change, and nothing says a regeneration was even attempted — a
  // failed run made indistinguishable from a section nobody asked about.
  // `sections` and `rejected` are no longer disjoint for this case, and that
  // is deliberate: the old text is still the best available content, but the
  // reason it could not be refreshed must survive too. Rendering that is
  // Task 5's job — this only has to keep the data from disappearing.
  it("T3 ruling 2: a rejected regeneration keeps the old text but the rejection reason must survive too", () => {
    const merged = mergeProseProposal(previous, {
      ...incoming,
      sections: { standard: incoming.sections.standard! }, // otoczenie not fresh this run
      rejected: { otoczenie: ["1 234,00"] },
      factsHashes: { standard: incoming.factsHashes.standard, otoczenie: "c".repeat(64) },
    });

    expect(merged.sections.otoczenie).toEqual(previous.sections.otoczenie);
    expect(merged.rejected.otoczenie).toEqual(["1 234,00"]);
  });

  it("no previous snapshot -> the incoming proposal verbatim", () => {
    expect(mergeProseProposal(null, incoming)).toEqual(incoming);
  });

  /**
   * `attempts` — what this run ASKED for, as opposed to what came back
   * (T5 fix round 1).
   *
   * The two must be separate maps. `factsHashes` may only move when TEXT
   * does, or a refused section would read fresh and the F-4 gate would wave
   * stale prose into a signed operat. But something has to record that the
   * automat was already asked at these exact facts, or step 6 buys the same
   * refusal on every entry. Hence one map that follows the outcome and one
   * that follows the request.
   */
  describe("attempts", () => {
    const AT = "c".repeat(64);
    const refusedRerequest = {
      ...incoming,
      sections: { standard: incoming.sections.standard! },
      rejected: { otoczenie: ["1 234,00"] },
      factsHashes: { standard: incoming.factsHashes.standard, otoczenie: AT },
      attempts: { standard: incoming.factsHashes.standard, otoczenie: AT },
    };

    it("records the attempt for a section this run REQUESTED and the worker refused", () => {
      const merged = mergeProseProposal(previous, refusedRerequest);

      expect(merged.attempts?.otoczenie).toBe(AT);
    });

    it("...while that same section stays STALE — the gate is not silenced", () => {
      // The whole reason attempts is a second map: `factsHashes` keeps the
      // OLD value, so `staleProseSections` and the F-4 blocker both go on
      // naming this section. Only the automatic RETRY is suppressed.
      const merged = mergeProseProposal(previous, refusedRerequest);

      expect(merged.factsHashes.otoczenie).toBe(previous.factsHashes.otoczenie);
      expect(merged.factsHashes.otoczenie).not.toBe(AT);
    });

    it("a section outside the batch keeps the attempt recorded before it", () => {
      const withAttempt: ProseSnapshot = {
        ...previous,
        attempts: { analiza_rynku: "d".repeat(64) },
      };

      expect(mergeProseProposal(withAttempt, incoming).attempts?.analiza_rynku).toBe(
        "d".repeat(64),
      );
    });

    it("neither side has attempts (rows persisted before the field): an empty map, no throw", () => {
      expect(mergeProseProposal(previous, incoming).attempts).toEqual({});
    });
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

  it("carries the attempts forward — a confirm asks the automat for nothing", () => {
    // The pleasant consequence: a section the appraiser deliberately BLANKED
    // keeps its attempt, so entering step 6 again does not quietly buy back
    // the text they just deleted. Move the facts and the attempt stops
    // matching, which is exactly when a fresh proposal is worth paying for.
    const attempted: ProseSnapshot = { ...previous, attempts: { otoczenie: "d".repeat(64) } };

    expect(confirmProseSnapshot(attempted, { opis_lokalu: HUMAN_TEXT }, meta).attempts).toEqual({
      otoczenie: "d".repeat(64),
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
