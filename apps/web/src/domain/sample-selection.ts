/**
 * sample-selection — pure domain module for "dobór próby v3" (wiki repo:
 * `wiki/decisions/ADR-015-dobor-proby-v3-ranking-podobienstwa.md` and
 * `docs/superpowers/specs/2026-08-20-dobor-proby-v3-design.md`).
 * ZERO I/O, ZERO clock: the valuation month is a parameter
 * (`todayMonth`), the pool comes from the caller. Deterministic by
 * construction — same pool + same params ⇒ same selection.
 *
 * Pipeline (ADR-015):
 *   1. radius: walk `radiusStepsM` (or `radiusOverrideM`), stop at the first
 *      radius whose pool after the area band reaches `minPoolAfterBand`
 *      (or the last step);
 *   2. hygiene → `rejected` with a reason code;
 *   3. area band → `rejected: out_of_area_band`, or the appraiser's own
 *      `areaRange`/`unitPriceRange` → `manual_area_range`/`manual_price_range`
 *      (Slice 6 — a given `areaRange` bound REPLACES the ±30% band);
 *   4. flags: IQR 1.5× on price/m² (n ≥ 8) → `price_outlier`;
 *      `market === null` → `market_unknown`; `market === null` ∧
 *      `seller === "osobaPrawna"` → also `primary_suspect` — flags never
 *      reject, but `price_outlier`/`primary_suspect` demote out of proposed
 *      (rule 5: stay in alternates);
 *   5. score = 100·sameBuilding + 60·sameParcel + 30·sameObreb − distanceM/100,
 *      tie → newer date, then candidateKey (transactionId|lokalId — total
 *      order even for several lokale of one act);
 *   6. proposed = top 20 (capped at 3 per building, rule 6), alternates = next 40.
 */
import { padObreb } from "./egib-id";
import type { Egib, SubjectEgib } from "./egib-id";
export { padObreb } from "./egib-id";
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
  /**
   * Building identity for rows WITHOUT an EGiB id (coop registry: normalised
   * address + building number, B3). `buildingKey()` falls back to it, so
   * ADR-015 rule 6 (max 3 per building) holds for every source. Absent on
   * RCN rows and on pools frozen before S1.
   */
  buildingRef?: string | null;
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
  /** tran_rodzaj_trans, e.g. "wolnyRynek"; null = source has no such field (coop registry, B4). */
  transType: string | null;
  /** lok_funkcja, e.g. "mieszkalna"; null = source has no such field (coop registry, B4). */
  function: string | null;
  /** tran_sprzedajacy: "osobaPrawna" | "osobaFizyczna" | … — developer sales are osobaPrawna. */
  seller: string | null;
  /** gml:pos normalised to {x: easting, y: northing}. */
  pos: { x: number; y: number } | null;
  /**
   * Street of the transaction, from the monthly GEOPOZ export (Slice 3d) — WITH its
   * prefix, exactly as the register writes it ("ul. Kościelna", "os. Zwycięstwa").
   * `null`/absent when the transaction lies outside Poznań (the city export cannot
   * cover it), when the export has no address for that lokal, or when the pool was
   * fetched before the index was ready — `CandidatePool.streetIndex` tells them apart.
   * Absent (not null) on pools frozen before this slice.
   */
  street?: string | null;
  /** House number — step 3 shows it, the operat never does (F-12). */
  streetNumber?: string | null;
  /** City from the transaction's own record, NOT from the subject (the bug Łukasz hit). */
  city?: string | null;
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
  radiusStepsM?: readonly number[];
  minPoolAfterBand?: number;
  /** Appraiser's slider — replaces the step walk. */
  radiusOverrideM?: number;
  weights?: ScoreWeights;
  proposedN?: number;
  alternatesN?: number;
  /** Cap on proposed rows from one building — overflow moves to alternates, ranking order kept (ADR-015 rule 6, default 3). */
  maxPerBuilding?: number;
  /**
   * Appraiser's own area band [m²] (Slice 6). REPLACES `areaBandPct` as soon as
   * either bound is given — an undefined bound then means "no limit on that
   * side", NOT "fall back to the ±30% band". `{}` (neither bound) changes
   * nothing: the default band still applies, which is what keeps F-14 green.
   */
  areaRange?: { min?: number; max?: number };
  /** Appraiser's own unit-price band [zł/m²] (Slice 6). Same bound semantics as `areaRange`; there is no default band to replace. */
  unitPriceRange?: { min?: number; max?: number };
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
  // 20, nie 12 — rzeczoznawca musi mieć zapas do ręcznego odrzucania (Aneta,
  // 2026-08-20: „niech zaciąga ok 20 a nie 12"). Próg 12 z bramy F-4 dotyczy
  // próby PRZYJĘTEJ do porównań, nie liczby propozycji; bramka F-14 mierzy WR
  // z prefiksu 12 tego rankingu (ADR-015, „Kryterium jakości").
  proposedN: 20,
  alternatesN: 40,
  maxPerBuilding: 3,
  iqrMinN: 8,
  iqrFactor: 1.5,
} as const;

export type RejectReason =
  | "share_not_whole"
  | "not_free_market"
  | "not_residential"
  | "no_price"
  | "out_of_window"
  | "out_of_area_band"
  | "primary_market"
  /** Outside the appraiser's own area band (Slice 6) — never coexists with `out_of_area_band`. */
  | "manual_area_range"
  /** Outside the appraiser's own unit-price band (Slice 6). */
  | "manual_price_range";

export type Flag =
  | "price_outlier"
  | "market_unknown"
  | "primary_suspect"
  /** function/transType unknown at the source (B4) — informative, never demotes. */
  | "attributes_unknown";

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
  // null = the source never had the field (B4): unknown is not a failed rule
  // (ADR-010, no silent defaults) — selectSample flags it `attributes_unknown`.
  if (c.function !== null && c.function !== "mieszkalna") reasons.push("not_residential");
  if (c.transType !== null && c.transType !== "wolnyRynek") reasons.push("not_free_market");
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

/**
 * Building identity: EGiB obręb.arkusz.działka.budynek, else `buildingRef`
 * (B3), else null (id did not parse and no address key — the caller treats
 * the row as its own building).
 */
export function buildingKey(c: Candidate): string | null {
  if (c.egib) {
    return `${padObreb(c.egib.obreb)}.${c.egib.arkusz}.${c.egib.dzialka}.${c.egib.budynek}`;
  }
  return c.buildingRef ?? null;
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
  // Total order: transactionId, then lokalId (candidateKey) — two lokale of one
  // notarial act can otherwise tie on score+date+transactionId, leaving input
  // order to decide (breaks determinism).
  const ak = candidateKey(a.candidate);
  const bk = candidateKey(b.candidate);
  if (ak === bk) return 0;
  return ak < bk ? -1 : 1;
}

export function iqrBounds(prices: number[], factor: number): { lo: number; hi: number } {
  const sorted = [...prices].sort((x, y) => x - y);
  const n = sorted.length;
  // Positional quartiles (sorted[floor(n/4)], sorted[floor(3n/4)]) — same
  // definition the spike and F-14 snapshots were calibrated with;
  // spreadsheets interpolate differently.
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
  // Ręczne pasma rzeczoznawcy (Slice 6). Sprawdzamy OBECNOŚĆ GRANIC, nie
  // obecność obiektu: `areaRange: {}` z formularza (oba pola puste) musi
  // zachowywać się dokładnie jak brak pola, inaczej pusty obiekt wyłączałby
  // pasmo ±30% i przestawiał dobór — a to jest dokładnie ta ścieżka, którą
  // chodzą snapshoty F-14.
  const areaMin = params.areaRange?.min;
  const areaMax = params.areaRange?.max;
  const manualArea = areaMin !== undefined || areaMax !== undefined;
  const priceMin = params.unitPriceRange?.min;
  const priceMax = params.unitPriceRange?.max;

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
      const reasons: RejectReason[] = [];
      if (manualArea) {
        if (
          (areaMin !== undefined && c.area < areaMin) ||
          (areaMax !== undefined && c.area > areaMax)
        )
          reasons.push("manual_area_range");
      } else if (c.area < loArea || c.area > hiArea) {
        reasons.push("out_of_area_band");
      }
      if (
        (priceMin !== undefined && c.pricePerM2 < priceMin) ||
        (priceMax !== undefined && c.pricePerM2 > priceMax)
      )
        reasons.push("manual_price_range");
      if (reasons.length > 0) {
        rejected.push({ candidate: c, reason: reasons[0], allReasons: reasons });
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
    if (c.function === null || c.transType === null) addFlag(candidateKey(c), "attributes_unknown");
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
    const bk = buildingKey(c) ?? candidateKey(c);
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
