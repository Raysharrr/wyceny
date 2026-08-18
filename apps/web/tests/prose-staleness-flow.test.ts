import { describe, expect, it } from "vitest";
import type { KcsInput } from "../src/domain/kcs";
import { proseSnapshotOf, staleProseSections, type ProseFactsInput } from "../src/domain/prose";
import { currentSectionFactsHash, currentSectionFactsHashes } from "../src/domain/prose-hash";
import {
  confirmProseSnapshot,
  mergeProseProposal,
  PROSE_SECTIONS,
  type ProseSection,
  type ProseSnapshot,
} from "../src/domain/prose-snapshot";
import { approvalGate } from "../src/domain/provenance";
import { approvableInput, confirmedProseFor } from "./fixtures/valuation-inputs";

/**
 * The whole per-section loop, end to end at the domain level: which sections
 * a changed fact puts back in the queue (T3), what the regeneration does to
 * them (T2), and what the F-4 gate then refuses (T4).
 *
 * Each of the three has its own unit tests; none of them exercises the
 * composition, and the composition is where the promise of this slice lives —
 * "correct one transaction price and you re-read the two sections that
 * describe it, not all six". A test per part can all pass while the parts
 * disagree about which sections moved.
 *
 * Fictional throughout (F-9): no address, sample or sentence here describes a
 * real property.
 */
const ADDRESS = "ul. Klonowa 5, m. Nowogród";

type DraftWithProse = KcsInput & { prose: ProseSnapshot };

/** The appraiser's own six sections, fingerprinted against THIS draft. */
function draftWithConfirmedProse(): DraftWithProse {
  const inputs = approvableInput("test-user").inputs!;
  return { ...inputs, prose: confirmedProseFor(ADDRESS, inputs) };
}

/** One corrected transaction price — the smallest edit the slice is about. */
function withCorrectedPrice(inputs: DraftWithProse): DraftWithProse {
  return {
    ...inputs,
    comparables: inputs.comparables.map((c, i) => (i === 0 ? { ...c, pricePerM2: 12_345 } : c)),
  };
}

/** What `proposeProse` sends back for the sections it was asked to redo. */
function regenerationOf(sections: ProseSection[], input: ProseFactsInput): ProseSnapshot {
  const factsHashes: Partial<Record<ProseSection, string>> = {};
  const texts: Partial<Record<ProseSection, string>> = {};
  for (const section of sections) {
    factsHashes[section] = currentSectionFactsHash(section, input);
    texts[section] = `Nowa propozycja automatu dla sekcji ${section} — dane testowe.`;
  }
  return proseSnapshotOf({
    sections: texts,
    rejected: {},
    model: "claude-sonnet-5",
    factsHashes,
    generatedAt: new Date("2026-08-18T09:00:00.000Z"),
  });
}

describe("a corrected transaction price → the two sections that describe it (T3 → T2 → T4)", () => {
  const before = draftWithConfirmedProse();
  const after = withCorrectedPrice(before);
  const factsInput: ProseFactsInput = { address: ADDRESS, inputs: after };
  const MOVED: ProseSection[] = ["analiza_rynku", "uzasadnienie"];
  const UNTOUCHED = PROSE_SECTIONS.filter((s) => !MOVED.includes(s));

  it("orders exactly the sections whose own facts moved — a proper subset of the six", () => {
    expect(staleProseSections(after.prose, factsInput, currentSectionFactsHash)).toEqual(MOVED);
    // The point of the whole slice: the other four are NOT in the batch, so
    // they are neither paid for nor put back in front of the appraiser.
    expect(UNTOUCHED.length).toBe(4);
  });

  it("blocks approval naming exactly them, BEFORE any regeneration has run", () => {
    // The gate's own defence (T4). The demotion below is the other one, and
    // it only happens if someone clicks "Wygeneruj ponownie" — nothing forces
    // that before approval, so the gate must not depend on it.
    const gate = approvalGate(after, {
      requireProse: true,
      currentSectionHashes: currentSectionFactsHashes(factsInput),
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.blockers.map((b) => b.path)).toEqual(MOVED.map((s) => `prose.${s}`));
      expect(gate.blockers.every((b) => b.label.includes("dane się zmieniły"))).toBe(true);
    }
  });

  it("brings them back demoted to to_verify, with the appraiser's text intact", () => {
    const merged = mergeProseProposal(after.prose, regenerationOf(MOVED, factsInput));

    for (const section of MOVED) {
      // The text the appraiser wrote is never overwritten — only the
      // confirmation is withdrawn, because every character of it predates the
      // corrected price.
      expect(merged.sections[section]).toEqual({
        value: after.prose.sections[section]!.value,
        provenance: { source: "rzeczoznawca", status: "to_verify" },
      });
      expect(merged.factsHashes[section]).toBe(currentSectionFactsHash(section, factsInput));
    }
    for (const section of UNTOUCHED) {
      expect(merged.sections[section]).toEqual(after.prose.sections[section]);
      expect(merged.factsHashes[section]).toBe(after.prose.factsHashes[section]);
    }
  });

  it("and the gate then refuses exactly those two as unaccepted, not as stale", () => {
    const merged = mergeProseProposal(after.prose, regenerationOf(MOVED, factsInput));
    const gate = approvalGate(
      { ...after, prose: merged },
      { requireProse: true, currentSectionHashes: currentSectionFactsHashes(factsInput) },
    );
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      // Same two sections, different sentence: the regeneration re-stamped
      // their fingerprints, so what is left is the appraiser's reading.
      expect(gate.blockers).toEqual([
        {
          path: "prose.analiza_rynku",
          label: "Analiza i charakterystyka rynku — do weryfikacji.",
        },
        {
          path: "prose.uzasadnienie",
          label: "Uzasadnienie wyniku — pozycja na tle próby — do weryfikacji.",
        },
      ]);
    }
  });

  it("one pass through step 6 clears it — and the four untouched sections never moved", () => {
    const merged = mergeProseProposal(after.prose, regenerationOf(MOVED, factsInput));
    const texts = Object.fromEntries(
      PROSE_SECTIONS.map((s) => [s, merged.sections[s]!.value]),
    ) as Record<ProseSection, string>;
    const reconfirmed = confirmProseSnapshot(merged, texts, {
      factsHashes: currentSectionFactsHashes(factsInput),
      now: new Date("2026-08-18T10:00:00.000Z"),
    });

    expect(
      approvalGate(
        { ...after, prose: reconfirmed },
        { requireProse: true, currentSectionHashes: currentSectionFactsHashes(factsInput) },
      ),
    ).toEqual({ ok: true });
    for (const section of UNTOUCHED) {
      expect(reconfirmed.sections[section]!.value).toBe(before.prose.sections[section]!.value);
    }
  });
});
