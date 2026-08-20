/**
 * sample-selection — pure domain module for "dobór próby v3" (ADR-015:
 * `docs/superpowers/sdd/2026-08-20-proba-v3-slice2/` and the wiki decision
 * it implements). ZERO I/O, ZERO clock: the valuation month is a parameter
 * (`todayMonth`), the pool comes from the caller. Deterministic by
 * construction — same pool + same params ⇒ same selection.
 *
 * Pipeline (ADR-015):
 *   1. radius: walk `radiusStepsM` (or `radiusOverrideM`), stop at the first
 *      radius whose pool after the area band reaches `minPoolAfterBand`
 *      (or the last step);
 *   2. hygiene → `rejected` with a reason code;
 *   3. area band → `rejected: out_of_area_band`;
 *   4. flags: IQR 1.5× on price/m² (n ≥ 8) → `price_outlier`;
 *      `market === null` → `market_unknown`; `market === null` ∧
 *      `seller === "osobaPrawna"` → also `primary_suspect` — flags never
 *      reject, but `price_outlier`/`primary_suspect` demote out of proposed
 *      (rule 5: stay in alternates);
 *   5. score = 100·sameBuilding + 60·sameParcel + 30·sameObreb − distanceM/100,
 *      tie → newer date, then transactionId (total order);
 *   6. proposed = top 12 (capped at 3 per building, rule 6), alternates = next 40.
 */
import { padObreb } from "./egib-id";
import type { Egib, SubjectEgib } from "./egib-id";
export type { Egib, SubjectEgib };

export type Market = "wtorny" | "pierwotny" | null;

export type Candidate = {
  /** tran_lokalny_id_iip */
  transactionId: string;
  /** dok_data, YYYY-MM-DD ("" when missing). */
  date: string;
  /** lok_pow_uzyt (0 when missing). */
  area: number;
  /** lok_cena_brutto / lok_pow_uzyt (0 when missing). */
  pricePerM2: number;
  /** lok_cena_brutto (0 when missing). */
  priceTotal: number;
  /** Parsed from lok_id_lokalu; null when the id did not parse. */
  egib: Egib | null;
  /** Raw lok_id_lokalu (kept for audit / exact matching). */
  lokalId: string;
  /** Planar distance from the subject point, EPSG:2180 metres. */
  distanceM: number;
  /** lok_nr_kond */
  floor: number | null;
  /** lok_liczba_izb */
  rooms: number | null;
  /** tran_rodzaj_rynku (28% filled in RCN). */
  market: Market;
  /** nier_udzial, e.g. "1/1". */
  share: string;
  /** tran_rodzaj_trans, e.g. "wolnyRynek". */
  transType: string;
  /** lok_funkcja, e.g. "mieszkalna". */
  function: string;
  /** tran_sprzedajacy: "osobaPrawna" | "osobaFizyczna" | … — developer sales are osobaPrawna. */
  seller: string | null;
  /** gml:pos normalised to {x: easting, y: northing}. */
  pos: { x: number; y: number } | null;
};

export type ScoreWeights = {
  sameBuilding: number;
  sameParcel: number;
  sameObreb: number;
  /** Penalty per metre of distance (spec: 1/100). */
  distancePerM: number;
};

export type SelectionParams = {
  subjectArea: number;
  subjectEgib?: SubjectEgib;
  /** "YYYY-MM" — the clock is a parameter (valuation month). */
  todayMonth: string;
  windowMonths?: number;
  areaBandPct?: number;
  radiusStepsM?: number[];
  minPoolAfterBand?: number;
  /** Appraiser's slider — replaces the step walk. */
  radiusOverrideM?: number;
  weights?: ScoreWeights;
  proposedN?: number;
  alternatesN?: number;
  /** Cap on proposed rows from one building — overflow moves to alternates, ranking order kept (ADR-015 rule 6, default 3). */
  maxPerBuilding?: number;
};

export const DEFAULT_WEIGHTS: ScoreWeights = {
  sameBuilding: 100,
  sameParcel: 60,
  sameObreb: 30,
  distancePerM: 1 / 100,
};

export const DEFAULTS = {
  windowMonths: 24,
  areaBandPct: 0.3,
  radiusStepsM: [500, 1000, 2000, 3000],
  minPoolAfterBand: 30,
  proposedN: 12,
  alternatesN: 40,
  maxPerBuilding: 3,
  iqrMinN: 8,
  iqrFactor: 1.5,
};

export type RejectReason =
  | "share_not_whole"
  | "not_free_market"
  | "not_residential"
  | "no_price"
  | "out_of_window"
  | "out_of_area_band"
  | "primary_market";

export type Flag = "price_outlier" | "market_unknown" | "primary_suspect";

export type Rejected = {
  candidate: Candidate;
  /** First reason in evaluation order — the one shown to the appraiser. */
  reason: RejectReason;
  /** Every reason that applies (diagnostics / "odrzucone" grouping). */
  allReasons: RejectReason[];
};

export type Scored = { candidate: Candidate; score: number };

export type Selection = {
  proposed: Candidate[];
  alternates: Candidate[];
  rejected: Rejected[];
  flags: Record<string, Flag[]>;
  radiusUsedM: number;
  counts: {
    pool: number;
    inRadius: number;
    afterHygiene: number;
    afterBand: number;
    proposed: number;
  };
  /** Full ranking of the band-passing pool (proposed ∪ alternates ∪ rest), with scores. */
  ranking: Scored[];
  /** Counts per radius step walked (diagnostics). */
  radiusWalk: { radiusM: number; inRadius: number; afterHygiene: number; afterBand: number }[];
};

// ---------------------------------------------------------------------------

export function floorMonth(todayMonth: string, windowMonths: number): string {
  const year = Number(todayMonth.slice(0, 4));
  const month = Number(todayMonth.slice(5, 7));
  const total = year * 12 + (month - 1) - windowMonths;
  const fy = Math.floor(total / 12);
  const fm = total - fy * 12;
  return `${fy}-${String(fm + 1).padStart(2, "0")}`;
}

export function isWholeShare(share: string): boolean {
  const s = share.trim();
  if (s === "" || s === "1" || s === "1/1") return s !== "";
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(s);
  return m !== null && m[1] === m[2];
}

export function hygieneReasons(c: Candidate, floor: string, todayMonth: string): RejectReason[] {
  const reasons: RejectReason[] = [];
  if (!(c.pricePerM2 > 0) || !(c.area > 0)) reasons.push("no_price");
  if (c.function !== "mieszkalna") reasons.push("not_residential");
  if (c.transType !== "wolnyRynek") reasons.push("not_free_market");
  if (!isWholeShare(c.share)) reasons.push("share_not_whole");
  const month = c.date.slice(0, 7);
  if (month.length !== 7 || month < floor || month > todayMonth) reasons.push("out_of_window");
  if (c.market === "pierwotny") reasons.push("primary_market");
  return reasons;
}

export function sameness(
  c: Candidate,
  s: SubjectEgib | undefined,
): { sameObreb: boolean; sameParcel: boolean; sameBuilding: boolean } {
  if (!s || !c.egib) return { sameObreb: false, sameParcel: false, sameBuilding: false };
  const sameObreb = padObreb(c.egib.obreb) === padObreb(s.obreb);
  const arkuszOk = s.arkusz === undefined || s.arkusz === "" || c.egib.arkusz === s.arkusz;
  const sameParcel = sameObreb && arkuszOk && c.egib.dzialka === s.dzialka;
  const sameBuilding =
    sameParcel && s.budynek !== undefined && s.budynek !== "" && c.egib.budynek === s.budynek;
  return { sameObreb, sameParcel, sameBuilding };
}

/** Building identity from EGiB: obręb.arkusz.działka.budynek (null when the id did not parse). */
export function buildingKey(c: Candidate): string | null {
  return c.egib
    ? `${padObreb(c.egib.obreb)}.${c.egib.arkusz}.${c.egib.dzialka}.${c.egib.budynek}`
    : null;
}

/** Flag/snapshot key — one notarial act (transactionId) can carry several lokale. */
export function candidateKey(c: Pick<Candidate, "transactionId" | "lokalId">): string {
  return `${c.transactionId}|${c.lokalId}`;
}

export function scoreCandidate(c: Candidate, s: SubjectEgib | undefined, w: ScoreWeights): number {
  const k = sameness(c, s);
  return (
    (k.sameBuilding ? w.sameBuilding : 0) +
    (k.sameParcel ? w.sameParcel : 0) +
    (k.sameObreb ? w.sameObreb : 0) -
    c.distanceM * w.distancePerM
  );
}

function compareScored(a: Scored, b: Scored): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.candidate.date !== b.candidate.date) return a.candidate.date < b.candidate.date ? 1 : -1;
  return a.candidate.transactionId < b.candidate.transactionId ? -1 : 1;
}

export function iqrBounds(prices: number[], factor: number): { lo: number; hi: number } {
  const sorted = [...prices].sort((x, y) => x - y);
  const n = sorted.length;
  // Same index quartiles as the v2 worker (rcn.py select_sample) — keeps the two comparable.
  const q1 = sorted[Math.floor(n / 4)];
  const q3 = sorted[Math.floor((3 * n) / 4)];
  const iqr = q3 - q1;
  return { lo: q1 - factor * iqr, hi: q3 + factor * iqr };
}

// ---------------------------------------------------------------------------

export function selectSample(candidates: Candidate[], params: SelectionParams): Selection {
  const windowMonths = params.windowMonths ?? DEFAULTS.windowMonths;
  const areaBandPct = params.areaBandPct ?? DEFAULTS.areaBandPct;
  const steps =
    params.radiusOverrideM !== undefined
      ? [params.radiusOverrideM]
      : (params.radiusStepsM ?? DEFAULTS.radiusStepsM);
  const minPool = params.minPoolAfterBand ?? DEFAULTS.minPoolAfterBand;
  const weights = params.weights ?? DEFAULT_WEIGHTS;
  const proposedN = params.proposedN ?? DEFAULTS.proposedN;
  const alternatesN = params.alternatesN ?? DEFAULTS.alternatesN;
  const maxPerBuilding = params.maxPerBuilding ?? DEFAULTS.maxPerBuilding;

  const floor = floorMonth(params.todayMonth, windowMonths);
  const loArea = params.subjectArea * (1 - areaBandPct);
  const hiArea = params.subjectArea * (1 + areaBandPct);

  const evaluate = (radiusM: number) => {
    const inRadius = candidates.filter((c) => c.distanceM <= radiusM);

    const rejected: Rejected[] = [];
    const clean: Candidate[] = [];
    for (const c of inRadius) {
      const reasons = hygieneReasons(c, floor, params.todayMonth);
      if (reasons.length > 0)
        rejected.push({ candidate: c, reason: reasons[0], allReasons: reasons });
      else clean.push(c);
    }
    const afterHygiene = clean.length;

    const banded: Candidate[] = [];
    for (const c of clean) {
      if (c.area < loArea || c.area > hiArea) {
        rejected.push({
          candidate: c,
          reason: "out_of_area_band",
          allReasons: ["out_of_area_band"],
        });
      } else banded.push(c);
    }
    return { radiusM, inRadius, rejected, banded, afterHygiene, afterBand: banded.length };
  };

  const walk: Selection["radiusWalk"] = [];
  let chosen: ReturnType<typeof evaluate> | null = null;
  for (const r of steps) {
    const ev = evaluate(r);
    walk.push({
      radiusM: r,
      inRadius: ev.inRadius.length,
      afterHygiene: ev.afterHygiene,
      afterBand: ev.afterBand,
    });
    chosen = ev;
    if (ev.afterBand >= minPool) break;
  }
  if (!chosen) throw new Error("selectSample: radiusStepsM must not be empty");

  // Flags (never reject).
  const flags: Record<string, Flag[]> = {};
  const addFlag = (id: string, f: Flag) => {
    (flags[id] ??= []).push(f);
  };
  if (chosen.banded.length >= DEFAULTS.iqrMinN) {
    const { lo, hi } = iqrBounds(
      chosen.banded.map((c) => c.pricePerM2),
      DEFAULTS.iqrFactor,
    );
    for (const c of chosen.banded) {
      if (c.pricePerM2 < lo || c.pricePerM2 > hi) addFlag(candidateKey(c), "price_outlier");
    }
  }
  for (const c of chosen.banded) {
    if (c.market === null) addFlag(candidateKey(c), "market_unknown");
    if (c.market === null && c.seller === "osobaPrawna")
      addFlag(candidateKey(c), "primary_suspect");
  }

  const ranking: Scored[] = chosen.banded
    .map((c) => ({ candidate: c, score: scoreCandidate(c, params.subjectEgib, weights) }))
    .sort(compareScored);

  const proposed: Candidate[] = [];
  const rest: Candidate[] = [];
  const perBuilding = new Map<string, number>();
  for (const s of ranking) {
    const c = s.candidate;
    const bk = buildingKey(c) ?? `?${c.transactionId}`;
    const used = perBuilding.get(bk) ?? 0;
    const fl = flags[candidateKey(c)] ?? [];
    const eligible =
      proposed.length < proposedN &&
      used < maxPerBuilding &&
      !fl.includes("price_outlier") &&
      !fl.includes("primary_suspect");
    if (eligible) {
      proposed.push(c);
      perBuilding.set(bk, used + 1);
    } else rest.push(c);
  }
  const alternates = rest.slice(0, alternatesN);

  return {
    proposed,
    alternates,
    rejected: chosen.rejected,
    flags,
    radiusUsedM: chosen.radiusM,
    counts: {
      pool: candidates.length,
      inRadius: chosen.inRadius.length,
      afterHygiene: chosen.afterHygiene,
      afterBand: chosen.afterBand,
      proposed: proposed.length,
    },
    ranking,
    radiusWalk: walk,
  };
}

/** Deduplicate by (transactionId, lokalId), keeping the highest tran_wersja_id. */
export function dedupe<T extends { transactionId: string; lokalId: string; versionId: string }>(
  records: T[],
  key: (r: T) => string = (r) => `${r.transactionId}|${r.lokalId}`,
): { kept: T[]; dropped: number } {
  const best = new Map<string, T>();
  let dropped = 0;
  for (const r of records) {
    const k = key(r);
    const prev = best.get(k);
    if (!prev) best.set(k, r);
    else {
      dropped += 1;
      if (r.versionId > prev.versionId) best.set(k, r);
    }
  }
  return { kept: [...best.values()], dropped };
}
