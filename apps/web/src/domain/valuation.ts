import { approvalGate, type Blocker } from "./provenance";
import { documentFieldBlockers } from "./document-model";
import { computeKcs, type Comparable, type KcsInput } from "./kcs";
import type { InputsProvenance } from "./provenance";
import type { NewValuationInput, Valuation } from "../ports/valuation";
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
 * The bulk-confirm mutation (spec §5): flips rcn comparables and the geocode
 * entry from to_verify to confirmed. The ONLY content mutation a draft
 * allows besides approval. Pure — the adapter persists the result.
 */
export function confirmSampleProvenance(v: Valuation): Valuation {
  assertDraft(v);
  if (!v.inputs) {
    throw new Error(`Valuation ${v.id} has no inputs snapshot — nothing to confirm`);
  }
  const comparables = v.inputs.comparables.map((c) =>
    c.source === "rcn" && c.status === "to_verify" ? { ...c, status: "confirmed" as const } : c,
  );
  const provenance = v.inputs.provenance?.geocode
    ? {
        ...v.inputs.provenance,
        geocode: { ...v.inputs.provenance.geocode, status: "confirmed" as const },
      }
    : v.inputs.provenance;
  return { ...v, inputs: { ...v.inputs, comparables, provenance } };
}

/**
 * Mirrors `confirmSampleProvenance` for the subject snapshot's provenance
 * groups (EGiB/MPZP): flips `ewidencja`/`mpzp` from to_verify to confirmed.
 * Draft-only (F-7) and throw-on-missing-inputs, byte-for-byte like its
 * sibling — a provenance map lacking `ewidencja`/`mpzp` keys (no subject
 * fetched) still passes through unchanged, same as `geocode` above.
 */
export function confirmSubjectProvenance(valuation: Valuation): Valuation {
  assertDraft(valuation);
  if (!valuation.inputs) {
    throw new Error(`Valuation ${valuation.id} has no inputs snapshot — nothing to confirm`);
  }
  const { provenance: p } = valuation.inputs;
  const provenance = p
    ? {
        ...p,
        ...(p.ewidencja ? { ewidencja: { ...p.ewidencja, status: "confirmed" as const } } : {}),
        ...(p.mpzp ? { mpzp: { ...p.mpzp, status: "confirmed" as const } } : {}),
      }
    : p;
  return { ...valuation, inputs: { ...valuation.inputs, provenance } };
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
  const areaFromDoc = p?.area && (p.area.source === "akt" || p.area.source === "odpis_kw");
  const provenance = p
    ? {
        ...p,
        ...(p.kw ? { kw: { ...p.kw, status: "confirmed" as const } } : {}),
        ...(areaFromDoc ? { area: { ...p.area, status: "confirmed" as const } } : {}),
      }
    : p;
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

/** Step-1 edit (Slice 11a): replaces the subject/kw slice of the draft and
 * NULLs wr — changed engine inputs must never keep a stale confirmed amount. */
export function applySubjectUpdate(v: Valuation, u: SubjectUpdate): Valuation {
  assertDraft(v);
  if (!v.inputs) throw new Error(`Valuation ${v.id} has no inputs snapshot — nothing to update`);
  // Group keys owned by this step are REPLACED, not merged — a detached
  // subject must not leave stale ewidencja/mpzp/kw provenance behind.
  const { ewidencja: _e, mpzp: _m, kw: _k, ...rest } = v.inputs.provenance ?? {};
  const provenance = { ...rest, ...u.provenance } as InputsProvenance;
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
  geocode?: InputsProvenance["geocode"];
};

export function applySampleUpdate(v: Valuation, u: SampleUpdate): Valuation {
  assertDraft(v);
  if (!v.inputs) throw new Error(`Valuation ${v.id} has no inputs snapshot — nothing to update`);
  const { geocode: _g, ...rest } = v.inputs.provenance ?? {};
  const provenance = { ...rest, ...(u.geocode ? { geocode: u.geocode } : {}) } as InputsProvenance;
  return {
    ...v,
    wr: null,
    inputs: { ...v.inputs, comparables: u.comparables, sampleMeta: u.sampleMeta, provenance },
  };
}

export type FeaturesUpdate = {
  features: KcsInput["features"];
  provenance: Pick<InputsProvenance, "weights" | "ratings" | "featureDefs">;
};

export function applyFeaturesUpdate(v: Valuation, u: FeaturesUpdate): Valuation {
  assertDraft(v);
  if (!v.inputs) throw new Error(`Valuation ${v.id} has no inputs snapshot — nothing to update`);
  const provenance = { ...v.inputs.provenance, ...u.provenance } as InputsProvenance;
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
 */
export function approveValuation(
  v: Valuation,
  now: Date,
  docs?: { docUrl: string; docxUrl: string },
): Valuation {
  assertDraft(v);
  if (!v.inputs) {
    throw new ApprovalBlockedError([{ path: "inputs", label: "Brak danych wejściowych operatu." }]);
  }
  const gate = approvalGate(v.inputs);
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
