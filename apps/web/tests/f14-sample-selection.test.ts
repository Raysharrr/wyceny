/**
 * F-14 — dobór próby v3 on frozen RCN snapshots (ADR-015).
 * Criterion today (no year-of-build source): WR from `proposed` within ±10% of the
 * appraiser's WR for ≥4/5 reference operaty and within ±5% for ≥2/5.
 * Regression below either bar = red CI. Snapshots: tests/fixtures/rcn-snapshots (spike A, 2026-08-20).
 */
import { describe, it, expect } from "vitest";
import { computeKcs } from "../src/domain/kcs";
import {
  selectSample,
  buildingKey,
  candidateKey,
  type Selection,
} from "../src/domain/sample-selection";
import { deriveSubjectEgib } from "../src/domain/egib-id";
import { loadSnapshot } from "./fixtures/rcn-snapshots/load";
import { OPERATY, TEST_ADDRESSES } from "./fixtures/rcn-snapshots/operaty";

function run(slug: string, area: number, todayMonth: string): Selection {
  const { subject, candidates } = loadSnapshot(slug);
  return selectSample(candidates, {
    subjectArea: area,
    todayMonth,
    subjectEgib: deriveSubjectEgib(subject.buildingId, subject.parcelId),
  });
}
const pct = (a: number, b: number) => Math.round(((a - b) / b) * 10000) / 100;

describe("F-14 — WR from the proposed sample vs the appraiser's operat", () => {
  const rows = OPERATY.map((op) => {
    const sel = run(op.slug, op.area, op.todayMonth);
    const { wr } = computeKcs({
      comparables: sel.proposed.map((c) => ({ pricePerM2: c.pricePerM2 })),
      area: op.area,
      features: op.features,
    });
    return {
      slug: op.slug,
      n: sel.proposed.length,
      radius: sel.radiusUsedM,
      wr,
      delta: pct(wr, op.pdfWrRounded!),
    };
  });
  // eslint-disable-next-line no-console
  console.table(rows);

  it("≥4/5 within ±10% and ≥2/5 within ±5%", () => {
    expect(rows.filter((r) => Math.abs(r.delta) <= 10).length).toBeGreaterThanOrEqual(4);
    expect(rows.filter((r) => Math.abs(r.delta) <= 5).length).toBeGreaterThanOrEqual(2);
  });

  it("sanity — the PDF sample itself reproduces the operat WR within 0.2%", () => {
    for (const op of OPERATY) {
      const { wr } = computeKcs({
        comparables: op.pdfSample.map((r) => ({ pricePerM2: r.pricePerM2 })),
        area: op.area,
        features: op.features,
      });
      expect(Math.abs(pct(wr, op.pdfWrRounded!))).toBeLessThanOrEqual(0.2);
    }
  });

  it.skip("top-20 contains ≥8/12 of the appraiser's transactions for ≥4/5 — enable after a year-of-build source (ADR-015 rule 10)", () => {
    const hits = OPERATY.map((op) => {
      const sel = run(op.slug, op.area, op.todayMonth);
      const top20 = sel.ranking
        .slice(0, 20)
        .map(
          (s) =>
            `${s.candidate.date.slice(0, 7)}|${s.candidate.area}|${Math.round(s.candidate.pricePerM2)}`,
        );
      return op.pdfSample.filter((r) =>
        top20.includes(`${r.month}|${r.area}|${Math.round(r.pricePerM2)}`),
      ).length;
    });
    expect(hits.filter((h) => h >= 8).length).toBeGreaterThanOrEqual(4);
  });
});

describe("F-14 — invariants on every snapshot (ADR-015 rules 5–9)", () => {
  const cases = [...OPERATY, ...TEST_ADDRESSES];
  it.each(cases.map((o) => [o.slug, o] as const))("%s", (_slug, op) => {
    const sel = run(op.slug, op.area, op.todayMonth);
    const lo = op.area * 0.7,
      hi = op.area * 1.3;
    const perBuilding = new Map<string, number>();
    for (const c of sel.proposed) {
      expect(sel.flags[candidateKey(c)] ?? []).not.toContain("price_outlier");
      expect(sel.flags[candidateKey(c)] ?? []).not.toContain("primary_suspect");
      expect(c.market).not.toBe("pierwotny");
      expect(c.transType).toBe("wolnyRynek");
      expect(c.area).toBeGreaterThanOrEqual(lo);
      expect(c.area).toBeLessThanOrEqual(hi);
      expect(c.distanceM).toBeLessThanOrEqual(sel.radiusUsedM);
      const k = buildingKey(c) ?? candidateKey(c);
      perBuilding.set(k, (perBuilding.get(k) ?? 0) + 1);
    }
    expect(Math.max(0, ...perBuilding.values())).toBeLessThanOrEqual(3);
    expect(sel.proposed.length).toBeLessThanOrEqual(12);
    expect(sel.alternates.length).toBeLessThanOrEqual(40);
  });

  it("Heweliusza 3 (50 m²) — DoD proxy: ≥6 proposed within 500 m", () => {
    const sel = run("heweliusza", 50, "2026-08");
    expect(sel.radiusUsedM).toBe(500);
    expect(sel.proposed.length).toBeGreaterThanOrEqual(6);
  });
  it("Sielawy 21F (92,34 m²) — no pierwotny in proposed, 12 rows", () => {
    const sel = run("sielawy", 92.34, "2026-08");
    expect(sel.proposed).toHaveLength(12);
  });
  it("snapshots carry real pagination and pair-duplicates (what the worker must reproduce)", () => {
    const k = loadSnapshot("koscielna");
    expect(k.pages).toBe(3);
    expect(k.deduped).toBeGreaterThan(0);
    expect(k.candidates.every((c) => c.egib !== null || !/_LOK$/.test(c.lokalId))).toBe(true);
  });
});
