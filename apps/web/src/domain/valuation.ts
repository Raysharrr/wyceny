import { approvalGate, type Blocker, type GateOptions } from "./provenance";
import { documentFieldBlockers } from "./document-model";
import { computeKcs, type Comparable, type KcsInput } from "./kcs";
import type { InputsProvenance } from "./provenance";
import type { NewValuationInput, Valuation } from "../ports/valuation";
import {
  confirmProseSnapshot,
  mergeProseProposal,
  type ProseSection,
  type ProseSnapshot,
} from "./prose-snapshot";
import {
  EMPTY_INSPECTION,
  INSPECTION_SECTIONS,
  MAX_INSPECTION_PHOTOS,
  totalInspectionPhotos,
  type InspectionSection,
  type InspectionSnapshot,
} from "./inspection";

/**
 * Pure Valuation domain logic.
 *
 * ZERO imports of drizzle/pg/db/client — this is the F-10 dependency-rule
 * boundary (only type-level imports from the pure `ports/` contracts are
 * allowed). Persistence lives entirely in `adapters/valuation-drizzle.ts`.
 */

/**
 * Builds the to-insert shape for a new Valuation. Every new Valuation starts
 * in `"in_progress"` — `id` and `createdAt` are assigned by the database on
 * insert.
 */
export function newValuation(input: NewValuationInput): Omit<Valuation, "id" | "createdAt"> {
  return {
    address: input.address,
    area: input.area,
    wr: input.wr,
    inputs: input.inputs,
    amountInWords: input.amountInWords,
    docUrl: input.docUrl,
    docxUrl: input.docxUrl ?? null,
    purpose: input.purpose ?? null,
    kwNumber: input.kwNumber ?? null,
    client: input.client ?? null,
    inspectionDate: input.inspectionDate ?? null,
    ownerId: input.ownerId,
    status: "in_progress",
    approvedAt: null,
    signedAt: null,
    supersedesId: null,
  };
}

/**
 * Write-once invariant (F-7): a `signed` Valuation can never be mutated.
 * Throws if the given Valuation is already signed.
 */
export function assertNotSigned(w: Valuation): void {
  if (w.status === "signed") {
    throw new Error(`Valuation ${w.id} is already signed — write-once, cannot be modified`);
  }
}

export class ApprovalBlockedError extends Error {
  constructor(public readonly blockers: Blocker[]) {
    super(`Approval blocked by F-4 gate: ${blockers.map((b) => b.path).join(", ")}`);
    this.name = "ApprovalBlockedError";
  }
}

/**
 * The approve action reads the draft, then spends seconds generating the
 * operat (worker + WMS + PDF conversion) before the status flip — a window
 * in which the owner can still mutate draft inputs (e.g. add an inspection
 * photo). The adapter throws this when the row's inputs no longer match
 * what the caller rendered from, closing that drift window (final review).
 */
export class InputsChangedError extends Error {
  constructor(id: string) {
    super(`Valuation ${id} inputs changed between read and approve — render is stale`);
    this.name = "InputsChangedError";
  }
}

function assertDraft(v: Valuation): void {
  if (v.status !== "in_progress") {
    throw new Error(`Valuation ${v.id} is not a draft (status: ${v.status}) — mutation refused`);
  }
}

/**
 * The step-3 confirmation: flips rcn comparables from to_verify to
 * confirmed. Pure — the adapter persists the result, in the same transaction
 * as the step-3 save (T7: confirming happens where the data is on screen).
 *
 * `geocode` is NOT flipped here any more (T7, spec §B). Geocoding is a
 * property of the ADDRESS, which is read on step 1, so
 * `confirmSubjectProvenance` owns it — a sample screen that never shows the
 * resolved point cannot be where the appraiser vouches for it.
 */
export function confirmSampleProvenance(v: Valuation): Valuation {
  assertDraft(v);
  if (!v.inputs) {
    throw new Error(`Valuation ${v.id} has no inputs snapshot — nothing to confirm`);
  }
  const comparables = v.inputs.comparables.map((c) =>
    c.source === "rcn" && c.status === "to_verify" ? { ...c, status: "confirmed" as const } : c,
  );
  return { ...v, inputs: { ...v.inputs, comparables } };
}

/**
 * Step 1's confirmation, on the provenance map alone: `ewidencja`/`mpzp`
 * (the EGiB/MPZP fetch) and `geocode` (the address's resolved point) go from
 * to_verify to confirmed. Split out of {@link confirmSubjectProvenance} so
 * the create path — the SAME "Dane się zgadzają — dalej" button, on a draft
 * that does not exist yet — can apply it without a Valuation to wrap.
 *
 * A map lacking any of those keys passes through unchanged: they are present
 * only when something was actually fetched.
 */
export function confirmSubjectEntries(p: InputsProvenance): InputsProvenance {
  return {
    ...p,
    ...(p.ewidencja ? { ewidencja: { ...p.ewidencja, status: "confirmed" as const } } : {}),
    ...(p.mpzp ? { mpzp: { ...p.mpzp, status: "confirmed" as const } } : {}),
    ...(p.geocode ? { geocode: { ...p.geocode, status: "confirmed" as const } } : {}),
  };
}

/**
 * Mirrors `confirmSampleProvenance` for the step-1 groups (EGiB/MPZP and,
 * since T7, the address's geocoding). Draft-only (F-7) and
 * throw-on-missing-inputs, byte-for-byte like its sibling.
 */
export function confirmSubjectProvenance(valuation: Valuation): Valuation {
  assertDraft(valuation);
  if (!valuation.inputs) {
    throw new Error(`Valuation ${valuation.id} has no inputs snapshot — nothing to confirm`);
  }
  const { provenance: p } = valuation.inputs;
  const provenance = p ? confirmSubjectEntries(p) : p;
  return { ...valuation, inputs: { ...valuation.inputs, provenance } };
}

/**
 * The KW half of step 1's confirmation, on the provenance map alone: `kw`
 * and — when the area was seeded from the document (source akt / odpis_kw) —
 * `area`. Split out for the same reason as {@link confirmSubjectEntries}.
 */
export function confirmKwEntries(p: InputsProvenance): InputsProvenance {
  const areaFromDoc = p.area && (p.area.source === "akt" || p.area.source === "odpis_kw");
  return {
    ...p,
    ...(p.kw ? { kw: { ...p.kw, status: "confirmed" as const } } : {}),
    ...(areaFromDoc ? { area: { ...p.area, status: "confirmed" as const } } : {}),
  };
}

/**
 * Mirrors `confirmSubjectProvenance` for the KW extract group: flips `kw`
 * — and `area` when the area was seeded from the document (source akt /
 * odpis_kw) — from to_verify to confirmed. Draft-only (F-7),
 * throw-on-missing-inputs, byte-for-byte like its siblings.
 */
export function confirmKwProvenance(valuation: Valuation): Valuation {
  assertDraft(valuation);
  if (!valuation.inputs) {
    throw new Error(`Valuation ${valuation.id} has no inputs snapshot — nothing to confirm`);
  }
  const { provenance: p } = valuation.inputs;
  const provenance = p ? confirmKwEntries(p) : p;
  return { ...valuation, inputs: { ...valuation.inputs, provenance } };
}

/**
 * Mirrors `confirmSubjectProvenance` for the feature preset group (Slice 7):
 * flips `weights` (always present) and `featureDefs` (when present — legacy
 * snapshots lack it) to confirmed. Draft-only, throw-on-missing-inputs,
 * byte-for-byte like its siblings.
 */
export function confirmFeaturesProvenance(valuation: Valuation): Valuation {
  assertDraft(valuation);
  if (!valuation.inputs) {
    throw new Error(`Valuation ${valuation.id} has no inputs snapshot — nothing to confirm`);
  }
  const { provenance: p } = valuation.inputs;
  const provenance = p
    ? {
        ...p,
        weights: { ...p.weights, status: "confirmed" as const },
        ...(p.featureDefs
          ? { featureDefs: { ...p.featureDefs, status: "confirmed" as const } }
          : {}),
      }
    : p;
  return { ...valuation, inputs: { ...valuation.inputs, provenance } };
}

export class InspectionLimitError extends Error {
  constructor() {
    super(`Inspection photo limit reached (${MAX_INSPECTION_PHOTOS})`);
    this.name = "InspectionLimitError";
  }
}

export type InspectionOp =
  | { kind: "add_photo"; section: InspectionSection; key: string }
  | { kind: "remove_photo"; section: InspectionSection; key: string }
  | { kind: "set_note"; note: string }
  | { kind: "set_date"; date: string };

/**
 * Draft-only inspection mutation (Slice 10) — the manifest sibling of the
 * confirm* family: assertDraft + throw-on-missing-inputs, pure, persisted
 * by the adapter in one tx with the `inspection_updated` audit row.
 */
export function applyInspectionOp(v: Valuation, op: InspectionOp): Valuation {
  assertDraft(v);
  if (!v.inputs) {
    throw new Error(`Valuation ${v.id} has no inputs snapshot — nothing to update`);
  }
  const current = v.inputs.inspection ?? EMPTY_INSPECTION;
  let inspection: InspectionSnapshot;
  if (op.kind === "add_photo") {
    if (totalInspectionPhotos(current) >= MAX_INSPECTION_PHOTOS) {
      throw new InspectionLimitError();
    }
    if (INSPECTION_SECTIONS.some((s) => current.photos[s].includes(op.key))) {
      throw new Error(`Photo key already present: ${op.key}`);
    }
    inspection = {
      ...current,
      photos: { ...current.photos, [op.section]: [...current.photos[op.section], op.key] },
    };
  } else if (op.kind === "remove_photo") {
    inspection = {
      ...current,
      photos: {
        ...current.photos,
        [op.section]: current.photos[op.section].filter((k) => k !== op.key),
      },
    };
  } else if (op.kind === "set_date") {
    return { ...v, inspectionDate: op.date || null };
  } else {
    const note = op.note.trim();
    inspection = { ...current, note: note.length > 0 ? note : null };
  }
  return { ...v, inputs: { ...v.inputs, inspection } };
}

/**
 * Persists a fresh set of LLM prose proposals on the draft (ADR-014).
 * Draft-only sibling of the apply* family. Unlike them it does NOT null `wr`:
 * prose is display/render material, never an engine input (F-1), so a new
 * proposal cannot invalidate a confirmed calculation.
 *
 * The snapshot is FOLDED onto what the draft already holds
 * ({@link mergeProseProposal}): "Wygeneruj ponownie" replaces `ai` sections
 * only, never text the appraiser confirmed.
 */
export function applyProseProposal(v: Valuation, prose: ProseSnapshot): Valuation {
  assertDraft(v);
  if (!v.inputs) throw new Error(`Valuation ${v.id} has no inputs snapshot — nothing to update`);
  return { ...v, inputs: { ...v.inputs, prose: mergeProseProposal(v.inputs.prose, prose) } };
}

/**
 * The appraiser's step-6 submit: every non-blank field becomes
 * `rzeczoznawca`/`confirmed` ({@link confirmProseSnapshot}), a blank one
 * removes the section. Draft-only, and `wr` survives for the same F-1 reason
 * as above.
 *
 * `factsHashes` and `now` are parameters, not reads: the domain neither
 * hashes nor tells the time (F-2). They are only used when the draft has no
 * snapshot yet — prose written entirely by hand.
 */
export function applyProseConfirmation(
  v: Valuation,
  texts: Partial<Record<ProseSection, string>>,
  meta: { factsHashes: Partial<Record<ProseSection, string>>; now: Date },
): Valuation {
  assertDraft(v);
  if (!v.inputs) throw new Error(`Valuation ${v.id} has no inputs snapshot — nothing to update`);
  return {
    ...v,
    inputs: { ...v.inputs, prose: confirmProseSnapshot(v.inputs.prose, texts, meta) },
  };
}

/**
 * Bucket key for a comparable — it NARROWS the candidates, it never selects
 * one. What decides whether a confirmation carries over is
 * {@link sameComparable} plus the one-for-one consumption in
 * {@link carryComparableConfirmations}; the key exists so that lookup is not
 * a scan of the whole snapshot. Keep it that way: the moment the key is
 * trusted to identify a row on its own, a stamp can move to a neighbour.
 *
 * Never the array index, for the same reason: deleting row 3 shifts every
 * later row, and a position-matched confirmation would then stay attached to
 * a DIFFERENT transaction than the one the appraiser verified — in a
 * document with legal effects, the worst failure this file could produce.
 *
 * `||`, not `??`: the worker emits an EMPTY id when RCN has none
 * (`rcn.py`: `get("tran_lokalny_id_iip") or ""`) and the HTTP adapter casts
 * the response without validating it, so `""` reaches real snapshots. It must
 * fall through to the content key like any other missing id, or every id-less
 * fetched row files under one bucket.
 */
function comparableKey(c: Comparable): string {
  return c.transactionId || comparableContentKey(c);
}

/**
 * The same key built from the three fields the appraiser reads off the row,
 * ignoring the fetched id entirely — what {@link promoteStoredRcnRows}
 * matches on. The id cannot be part of that comparison, because dropping it
 * is the move being caught. One definition of "the same row by content".
 */
function comparableContentKey(c: Comparable): string {
  return `${c.date ?? ""}|${c.area ?? ""}|${c.pricePerM2}`;
}

/**
 * Every field of {@link Comparable} the appraiser reads off the row, `status`
 * excluded — that is the thing being recomputed, not part of what was
 * verified. ADD ANY NEW FIELD HERE: one left out means a row that changed on
 * screen still counts as unchanged and silently keeps its `confirmed` stamp.
 */
function sameComparable(a: Comparable, b: Comparable): boolean {
  return (
    a.pricePerM2 === b.pricePerM2 &&
    a.date === b.date &&
    a.area === b.area &&
    a.source === b.source &&
    a.transactionId === b.transactionId
  );
}

/**
 * Gives a row back the `rcn` source the SNAPSHOT records for it, however the
 * request labelled it. The step-3 ACL derives the source from the fetched id,
 * which a crafted request can simply omit — and `sameComparable` cannot cover
 * the gap, because it compares `transactionId`. The draft can: it is the
 * server's own record of what the RCN fetch returned.
 *
 * This lives in the domain rather than in the ACL because it needs the
 * snapshot the WRITE transaction holds locked. Deriving it from a draft read
 * moments earlier would fail toward `manual`/`confirmed` under a concurrent
 * save — machine data printed as the appraiser's own measurement (F-5), the
 * unsafe direction.
 *
 * Promotion only, never demotion: a snapshot MANUAL row leaves an incoming
 * rcn row alone, or a row saved before ids existed would confirm itself. A
 * hand-typed row that happens to match a fetched one is over-promoted to
 * `to_verify` — harmless, since the step-3 save confirms it in the same
 * transaction, whereas under-promotion would mislabel the operat.
 */
function promoteStoredRcnRows(snapshot: Comparable[], incoming: Comparable[]): Comparable[] {
  const fetched = new Set(snapshot.filter((c) => c.source === "rcn").map(comparableContentKey));
  if (fetched.size === 0) return incoming;
  return incoming.map((c) =>
    c.source !== "rcn" && fetched.has(comparableContentKey(c))
      ? { ...c, source: "rcn" as const, status: "to_verify" as const }
      : c,
  );
}

/**
 * Carries each confirmation from the snapshot onto the row it actually
 * belongs to. A row keeps its status only when the snapshot holds an entry
 * with the same key AND the same fields; anything else (edited, inserted,
 * merely shifted by a deletion) is data the appraiser has not seen in this
 * shape, so an rcn row goes back to `to_verify`.
 *
 * Rows the appraiser typed themselves are left as the ACL stamped them:
 * `confirmSampleProvenance` flips only rcn rows, so a manual row parked at
 * `to_verify` could never be confirmed again and would block approval (F-4)
 * forever. Same reason a legacy snapshot row (no `status` at all) hands the
 * verdict back to the ACL instead of stamping `undefined` over it.
 *
 * Duplicate keys are consumed one-for-one: two identical rows carry two
 * confirmations, and neither lends its stamp to a third.
 */
function carryComparableConfirmations(
  snapshot: Comparable[],
  incoming: Comparable[],
): Comparable[] {
  const unclaimed = new Map<string, Comparable[]>();
  for (const c of snapshot) {
    const key = comparableKey(c);
    const bucket = unclaimed.get(key);
    if (bucket) bucket.push(c);
    else unclaimed.set(key, [c]);
  }
  return incoming.map((c) => {
    const bucket = unclaimed.get(comparableKey(c));
    const at = bucket ? bucket.findIndex((previous) => sameComparable(previous, c)) : -1;
    if (bucket && at >= 0) {
      const [matched] = bucket.splice(at, 1);
      return matched.status ? { ...c, status: matched.status } : c;
    }
    return c.source === "rcn" ? { ...c, status: "to_verify" as const } : c;
  });
}

/**
 * Structural equality for the snapshot fragments a wizard step owns — plain
 * JSON only (objects, arrays, primitives; no Dates, no class instances).
 * Compared field by field rather than as JSON text because the two sides
 * arrive by different routes (a jsonb read vs a freshly validated form), and
 * key order must not be what decides whether the appraiser keeps a
 * confirmation. A key that is absent on one side and `undefined` on the other
 * counts as equal: jsonb drops undefined on the way in, so the difference is
 * an artefact of storage, not an edit.
 */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameJson(item, b[i]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (!sameJson(left[key], right[key])) return false;
  }
  return true;
}

/** Provenance entries the step-1 form owns and re-derives on every save. */
const SUBJECT_GROUP_KEYS = ["area", "ewidencja", "mpzp", "kw", "geocode"] as const;
/** Provenance entries the step-4 form owns and re-derives on every save. */
const FEATURES_GROUP_KEYS = ["weights", "ratings", "featureDefs"] as const;

/**
 * Gives `next` back the statuses the appraiser had already granted. The ACL
 * re-derives provenance from the SOURCE alone, so an auto-fetched group comes
 * back `to_verify` on every save — taking that verdict wholesale is what used
 * to wipe confirmations an edit never touched. Call ONLY once the group's
 * content is known to be unchanged; a differing `source` means the data moved
 * anyway, so that entry keeps the fresh verdict.
 */
function carryGroupStatuses(
  previous: InputsProvenance | null | undefined,
  next: InputsProvenance,
  keys: readonly ((typeof SUBJECT_GROUP_KEYS)[number] | (typeof FEATURES_GROUP_KEYS)[number])[],
): InputsProvenance {
  const carried: InputsProvenance = { ...next };
  for (const key of keys) {
    const before = previous?.[key];
    const after = carried[key];
    if (before && after && before.source === after.source) {
      carried[key] = { ...after, status: before.status };
    }
  }
  return carried;
}

/**
 * Step 1 owns the subject as ONE snapshot: the address, the EGiB/MPZP fetch,
 * the KW extract and the area they came with are read together on one screen,
 * so a confirmation survives only when the whole group came back identical.
 * The coarse grain is deliberate — it errs toward `to_verify`, the only safe
 * direction for F-4.
 *
 * The address is compared here even though the UI re-fetches EGiB/MPZP
 * whenever it changes (which moves `subjectMeta.fetchedAt` and would lapse
 * the group anyway): that is a UI invariant this module cannot see, and
 * leaning on it would mean a later change to the re-fetch — or any path that
 * sets `subject` without a fresh `fetchedAt` — silently starts keeping
 * confirmations for a parcel nobody re-read.
 */
function sameSubjectGroup(previousAddress: string, previous: KcsInput, u: SubjectUpdate): boolean {
  return (
    previousAddress === u.address &&
    previous.area === u.area &&
    sameJson(previous.subject ?? null, u.subject ?? null) &&
    sameJson(previous.subjectMeta ?? null, u.subjectMeta ?? null) &&
    sameJson(previous.kw ?? null, u.kw ?? null) &&
    sameJson(previous.kwMeta ?? null, u.kwMeta ?? null)
  );
}

export type SubjectUpdate = {
  address: string;
  area: number;
  purpose: NonNullable<Valuation["purpose"]>;
  kwNumber: string | null;
  client: string;
  subject: KcsInput["subject"];
  subjectMeta: KcsInput["subjectMeta"];
  kw: KcsInput["kw"];
  kwMeta: KcsInput["kwMeta"];
  provenance: Partial<InputsProvenance> & Pick<InputsProvenance, "address" | "area">;
};

/**
 * The geocode entry's ACL shape: a machine-resolved point enters
 * re-verification, like every other fetched value.
 */
const GEOCODE_TO_VERIFY = { source: "geokoder", status: "to_verify" } as const;

/** Step-1 edit (Slice 11a): replaces the subject/kw slice of the draft and
 * NULLs wr — changed engine inputs must never keep a stale confirmed amount. */
export function applySubjectUpdate(v: Valuation, u: SubjectUpdate): Valuation {
  assertDraft(v);
  if (!v.inputs) throw new Error(`Valuation ${v.id} has no inputs snapshot — nothing to update`);
  // Group keys owned by this step are REPLACED, not merged — a detached
  // subject must not leave stale ewidencja/mpzp/kw/geocode provenance behind.
  const { ewidencja: _e, mpzp: _m, kw: _k, geocode: _g, ...rest } = v.inputs.provenance ?? {};
  // `geocode` is a step-1 key since T7 (spec §B): geocoding is a property of
  // the ADDRESS, so it is stamped here and confirmed by
  // `confirmSubjectProvenance` — step 3 no longer touches it.
  //
  // The entry exists once something has actually geocoded this draft's
  // address: the step-1 EGiB/MPZP fetch (`subjectMeta` carries the resolved
  // x/y) or the step-3 RCN fetch (`sampleMeta` — the worker resolves the same
  // address to a point before querying). The second disjunct is what keeps
  // the F-4 gate REACHABLE: the gate demands this entry whenever `sampleMeta`
  // is set, so a draft that skipped the step-1 fetch would otherwise be
  // blocked on a confirmation no step could ever give.
  const geocoded = (u.subjectMeta ?? null) != null || (v.inputs.sampleMeta ?? null) != null;
  const reassigned = {
    ...rest,
    ...u.provenance,
    ...(geocoded ? { geocode: GEOCODE_TO_VERIFY } : {}),
  } as InputsProvenance;
  const provenance = sameSubjectGroup(v.address, v.inputs, u)
    ? carryGroupStatuses(v.inputs.provenance, reassigned, SUBJECT_GROUP_KEYS)
    : reassigned;
  return {
    ...v,
    address: u.address,
    area: u.area,
    purpose: u.purpose,
    kwNumber: u.kwNumber,
    client: u.client,
    wr: null,
    inputs: {
      ...v.inputs,
      area: u.area,
      subject: u.subject ?? null,
      subjectMeta: u.subjectMeta ?? null,
      kw: u.kw ?? null,
      kwMeta: u.kwMeta ?? null,
      provenance,
    },
  };
}

export type SampleUpdate = {
  comparables: Comparable[];
  sampleMeta: KcsInput["sampleMeta"];
};

/**
 * Step-3 edit: the transactions and their metadata, and nothing else. The
 * provenance map is left ENTIRELY alone — until T7 this step re-stamped
 * `geocode` back to `to_verify` on every save, so correcting one transaction
 * price cost the appraiser a geocoding confirmation they had given on
 * step 1. That key moved to {@link applySubjectUpdate}, where the address it
 * describes lives.
 */
export function applySampleUpdate(v: Valuation, u: SampleUpdate): Valuation {
  assertDraft(v);
  if (!v.inputs) throw new Error(`Valuation ${v.id} has no inputs snapshot — nothing to update`);
  const comparables = carryComparableConfirmations(
    v.inputs.comparables,
    promoteStoredRcnRows(v.inputs.comparables, u.comparables),
  );
  return {
    ...v,
    wr: null,
    inputs: { ...v.inputs, comparables, sampleMeta: u.sampleMeta },
  };
}

export type FeaturesUpdate = {
  features: KcsInput["features"];
  provenance: Pick<InputsProvenance, "weights" | "ratings" | "featureDefs">;
};

export function applyFeaturesUpdate(v: Valuation, u: FeaturesUpdate): Valuation {
  assertDraft(v);
  if (!v.inputs) throw new Error(`Valuation ${v.id} has no inputs snapshot — nothing to update`);
  const reassigned = { ...v.inputs.provenance, ...u.provenance } as InputsProvenance;
  // The feature group is one screen too: weights, ratings and the rating-scale
  // definitions are confirmed together, so they lapse together.
  const provenance = sameJson(v.inputs.features, u.features)
    ? carryGroupStatuses(v.inputs.provenance, reassigned, FEATURES_GROUP_KEYS)
    : reassigned;
  return { ...v, wr: null, inputs: { ...v.inputs, features: u.features, provenance } };
}

export class CalculationNotReadyError extends Error {
  constructor() {
    super("Calculation needs at least 3 comparables and 1 feature");
    this.name = "CalculationNotReadyError";
  }
}

/** Step-5 confirm: the ONLY place the wizard writes wr. Same engine call the
 * legacy create action used (F-1: computeKcs itself untouched). */
export function applyCalculationConfirm(v: Valuation): Valuation {
  assertDraft(v);
  if (!v.inputs) throw new Error(`Valuation ${v.id} has no inputs snapshot — nothing to confirm`);
  if (v.inputs.comparables.length < 3 || v.inputs.features.length === 0) {
    throw new CalculationNotReadyError();
  }
  return { ...v, wr: computeKcs(v.inputs).wr };
}

/**
 * The approve mutation — F-4 gate as aggregate invariant (ADR-012). A draft
 * without a snapshot can never pass (default-deny). The gate is merged with
 * the document-field blockers (spec §4): approval also requires the four
 * operat header fields (purpose/kw/client/inspection date), so a legacy draft
 * missing them is refused. When `docs` are supplied (the approve action has
 * generated + stored the operat), the returned Valuation carries the URLs —
 * this is the only place `docUrl`/`docxUrl` are set on approval.
 *
 * `gateOptions` carries what only the app layer can know — today whether the
 * prose sections are part of the invariant (FR-6 kill switch). It is passed
 * through, never derived here: this module reads no env (F-10).
 */
export function approveValuation(
  v: Valuation,
  now: Date,
  docs?: { docUrl: string; docxUrl: string },
  gateOptions?: GateOptions,
): Valuation {
  assertDraft(v);
  if (!v.inputs) {
    throw new ApprovalBlockedError([{ path: "inputs", label: "Brak danych wejściowych operatu." }]);
  }
  const gate = approvalGate(v.inputs, gateOptions);
  const blockers = [...(gate.ok ? [] : gate.blockers), ...documentFieldBlockers(v)];
  if (blockers.length > 0) {
    throw new ApprovalBlockedError(blockers);
  }
  return {
    ...v,
    status: "approved",
    approvedAt: now,
    ...(docs ? { docUrl: docs.docUrl, docxUrl: docs.docxUrl } : {}),
  };
}

/** Closed FR-12 audit-action list — the only actions `audit_log` may record. */
export const AUDIT_ACTIONS = [
  "created",
  "subject_updated",
  "sample_updated",
  "features_updated",
  "calculation_confirmed",
  "sample_confirmed",
  "subject_confirmed",
  "kw_confirmed",
  "features_confirmed",
  "inspection_updated",
  "prose_generated",
  "prose_confirmed",
  "approved",
  "signed",
  "version_created",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export class NotSignableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotSignableError";
  }
}

/**
 * The sign mutation (F-7): approved → signed, exactly once. Legacy rows
 * (stub era: no inputs snapshot / no DOCX) are not signable — there is
 * nothing to re-render the final document from.
 */
export function signValuation(v: Valuation, now: Date): Valuation {
  if (v.status !== "approved") {
    throw new NotSignableError(
      `Valuation ${v.id} is not approved (status: ${v.status}) — cannot sign`,
    );
  }
  if (!v.inputs || !v.docxUrl) {
    throw new NotSignableError(`Valuation ${v.id} is a legacy row — not signable`);
  }
  return { ...v, status: "signed", signedAt: now };
}

/**
 * Comparables only ever carry "rcn" (RCN auto-fetch) or "manual" (typed by
 * the appraiser) — mirrors the rcn-vs-everything-else rule already used by
 * `confirmSampleProvenance` and `provenance.ts`'s gate. Only the machine
 * ("rcn") rows get re-verified in a new version.
 */
function resetComparable(c: Comparable): Comparable {
  return c.source === "rcn" ? { ...c, status: "to_verify" } : c;
}

/**
 * Provenance-map entries carry the full `ProvenanceSource` union (F-5/ADR-010).
 * Only "rzeczoznawca" (typed directly by the appraiser) survives a new
 * version unreset — every other source (geokoder, ewidencja, mpzp, akt,
 * odpis_kw, preset, ...) is machine/registry-derived and gets re-verified
 * (AI-first ACL: you don't confirm what you typed — and bulk confirm
 * actions could not flip a "rzeczoznawca" entry back anyway).
 */
function resetProvenanceEntry<T extends { source?: string; status?: string }>(entry: T): T {
  return entry.source === "rzeczoznawca" ? entry : { ...entry, status: "to_verify" };
}

/**
 * Prose in a new version (FR-6): the TEXT survives, the confirmation does
 * not. Unlike the provenance map above, "rzeczoznawca" earns no exemption
 * here — after step 6 every section IS rzeczoznawca/confirmed, so keeping
 * them would mean the successor inherits paragraphs marked as read and
 * accepted that nobody read in THIS version, and the F-4 gate would wave
 * them into a signed operat. Dropping the snapshot instead would destroy
 * handwritten text and buy a fresh (paid) generation, so the appraiser
 * keeps the text and owes it one more reading.
 */
function resetProse(prose: ProseSnapshot): ProseSnapshot {
  const sections: ProseSnapshot["sections"] = {};
  for (const [section, entry] of Object.entries(prose.sections) as Array<
    [ProseSection, ProseSnapshot["sections"][ProseSection]]
  >) {
    if (entry) {
      sections[section] = { ...entry, provenance: { ...entry.provenance, status: "to_verify" } };
    }
  }
  return { ...prose, sections };
}

/**
 * Versioning (NFR-3): copies a SIGNED valuation into a fresh draft that
 * supersedes it. Full confirm → approve → sign cycle starts over.
 */
export function newVersionOf(v: Valuation): Omit<Valuation, "id" | "createdAt"> {
  if (v.status !== "signed") {
    throw new Error(`Valuation ${v.id} is not signed — only signed valuations get new versions`);
  }
  const inputs = v.inputs
    ? {
        ...v.inputs,
        comparables: v.inputs.comparables.map(resetComparable),
        provenance: v.inputs.provenance
          ? (Object.fromEntries(
              Object.entries(v.inputs.provenance).map(([k, e]) => [
                k,
                e ? resetProvenanceEntry(e) : e,
              ]),
            ) as InputsProvenance)
          : v.inputs.provenance,
        ...(v.inputs.prose ? { prose: resetProse(v.inputs.prose) } : {}),
      }
    : v.inputs;
  return {
    address: v.address,
    area: v.area,
    wr: v.wr,
    inputs,
    amountInWords: null,
    docUrl: null,
    docxUrl: null,
    purpose: v.purpose,
    kwNumber: v.kwNumber,
    client: v.client,
    inspectionDate: v.inspectionDate,
    ownerId: v.ownerId,
    status: "in_progress",
    approvedAt: null,
    signedAt: null,
    supersedesId: v.id,
  };
}
