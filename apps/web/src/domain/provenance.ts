import { isBlocking, sourced, type Provenance, type ProvenanceStatus } from "@wyceny/shared";

/**
 * F-4 approval gate — the aggregate invariant from ADR-010/ADR-012.
 * Default-deny: a value with missing provenance counts as `none` and blocks.
 * Pure, zero I/O (F-10). Blocker labels are Polish UI copy.
 */
export const REQUIRED_SAMPLE_SIZE = 12;

export type InputsProvenance = {
  address: Provenance;
  area: Provenance;
  weights: Provenance;
  ratings: Provenance;
  /** Present only when the draft was seeded by an RCN fetch (sampleMeta set). */
  geocode?: Provenance;
  /** Present only when a subject snapshot (EGiB/MPZP) was attached to the draft. */
  ewidencja?: Provenance;
  mpzp?: Provenance;
  /** Present only when a KW extract (deed/excerpt upload) was attached. */
  kw?: Provenance;
};

export type Blocker = { path: string; label: string };

export type GateResult = { ok: true } | { ok: false; blockers: Blocker[] };

/** Structurally compatible with KcsInput — callers pass the snapshot directly. */
export type GateInput = {
  comparables: Array<{ source?: "rcn" | "manual"; status?: ProvenanceStatus }>;
  sampleMeta?: unknown | null;
  subject?: unknown | null;
  kw?: {
    source: "akt" | "odpis_kw";
    kwLokalu: string | null;
    kwGruntu: string | null;
    deweloperski: boolean;
  } | null;
  provenance?: InputsProvenance | null;
};

const SCALAR_KEYS = ["address", "area", "weights", "ratings"] as const;

const SCALAR_LABEL: Record<(typeof SCALAR_KEYS)[number], string> = {
  address: "Adres",
  area: "Powierzchnia",
  weights: "Wagi cech",
  ratings: "Oceny cech",
};

function statusLabel(status: ProvenanceStatus): string {
  return status === "to_verify" ? "do weryfikacji" : "brak prowenancji";
}

export function approvalGate(input: GateInput): GateResult {
  const blockers: Blocker[] = [];

  if (input.comparables.length < REQUIRED_SAMPLE_SIZE) {
    blockers.push({
      path: "comparables",
      label: `Próba ma ${input.comparables.length} transakcji — wymagane co najmniej ${REQUIRED_SAMPLE_SIZE}.`,
    });
  }

  input.comparables.forEach((c, i) => {
    const source = c.source === "rcn" ? "rcn" : "rzeczoznawca";
    const status: ProvenanceStatus = c.status ?? "none";
    const s = sourced(c, source, status);
    if (isBlocking(s)) {
      blockers.push({
        path: `comparables[${i}]`,
        label: `Transakcja ${i + 1}${source === "rcn" ? " (RCN)" : ""} — ${statusLabel(status)}.`,
      });
    }
  });

  for (const key of SCALAR_KEYS) {
    const entry = input.provenance?.[key];
    const s = sourced(key, entry?.source ?? "rzeczoznawca", entry?.status ?? "none");
    if (isBlocking(s)) {
      blockers.push({
        path: `provenance.${key}`,
        label: `${SCALAR_LABEL[key]} — ${statusLabel(entry?.status ?? "none")}.`,
      });
    }
  }

  if (input.sampleMeta != null) {
    const geocode = input.provenance?.geocode;
    const s = sourced("geocode", geocode?.source ?? "geokoder", geocode?.status ?? "none");
    if (isBlocking(s)) {
      blockers.push({
        path: "provenance.geocode",
        label: `Geokodowanie adresu — ${statusLabel(geocode?.status ?? "none")}.`,
      });
    }
  }

  // Subject data (EGiB/MPZP): gated whenever a subject snapshot exists.
  // Decision 10: confirmed "no plan" is also a conscious approval — mpzp group
  // covers both plan data and its absence.
  if (input.subject != null) {
    const ewidencja = input.provenance?.ewidencja;
    const sE = sourced("ewidencja", ewidencja?.source ?? "ewidencja", ewidencja?.status ?? "none");
    if (isBlocking(sE)) {
      blockers.push({
        path: "provenance.ewidencja",
        label: `Dane ewidencyjne przedmiotu (EGiB) — ${statusLabel(ewidencja?.status ?? "none")}.`,
      });
    }
    const mpzp = input.provenance?.mpzp;
    const sM = sourced("mpzp", mpzp?.source ?? "mpzp", mpzp?.status ?? "none");
    if (isBlocking(sM)) {
      blockers.push({
        path: "provenance.mpzp",
        label: `Przeznaczenie planistyczne (MPZP) — ${statusLabel(mpzp?.status ?? "none")}.`,
      });
    }
  }

  // KW extract (deed/excerpt upload): gated whenever a kw snapshot exists.
  // Manual kwNumber entry attaches no snapshot and adds no blockers here.
  if (input.kw != null) {
    const kwProv = input.provenance?.kw;
    const sK = sourced("kw", kwProv?.source ?? input.kw.source, kwProv?.status ?? "none");
    if (isBlocking(sK)) {
      blockers.push({
        path: "provenance.kw",
        label: `Stan prawny (KW) — ${statusLabel(kwProv?.status ?? "none")}.`,
      });
    }
    if (!input.kw.kwGruntu) {
      blockers.push({
        path: "kw.kwGruntu",
        label: "Numer KW gruntu (księgi macierzystej) — brak.",
      });
    }
    if (!input.kw.kwLokalu && !input.kw.deweloperski) {
      blockers.push({
        path: "kw.kwLokalu",
        label:
          "Numer KW lokalu — brak (zaznacz wariant deweloperski, jeśli lokal nie ma własnej księgi).",
      });
    }
  }

  return blockers.length === 0 ? { ok: true } : { ok: false, blockers };
}
