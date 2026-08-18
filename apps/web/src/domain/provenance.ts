import {
  isBlocking,
  sourced,
  type Provenance,
  type ProvenanceStatus,
  type Sourced,
} from "@wyceny/shared";
import { PROSE_SECTION_LABEL, PROSE_SECTIONS, type ProseSection } from "./prose-snapshot";

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
  /**
   * Present on every Slice-7+ snapshot (assignProvenance always sets it);
   * absent on legacy snapshots — the gate skips it then (no retro-blockers
   * on old prod drafts).
   */
  featureDefs?: Provenance;
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
  /** Prose snapshot (FR-6) — gated only when the caller asks for it, see `GateOptions`. */
  prose?: {
    sections: Partial<Record<ProseSection, Sourced<string>>>;
    /** Facts the text was last generated from or accepted against. */
    factsHash?: string;
  } | null;
};

export type GateOptions = {
  /**
   * Whether the operat's descriptive sections are part of the invariant.
   * The app layer computes this from the NEXT_PUBLIC_PROSE kill switch and
   * passes it in — `domain/` reads no env (F-10). Omitted (every pre-FR-6
   * call site) means "don't gate prose", so the flag being off is
   * indistinguishable from the world before the feature existed.
   */
  requireProse?: boolean;
  /**
   * Fingerprint of the draft's CURRENT facts, for comparison against the one
   * the stored prose carries. Computed by the caller, never here: the hash
   * needs `node:crypto` (`domain/prose-hash.ts`) and this module is imported
   * from Client Components — same reason `now` is passed into `approve`.
   *
   * Absent means "the caller cannot tell", and staleness is then NOT checked:
   * every production caller supplies it (the approve action, both server
   * components, and the adapter computes its own inside the write
   * transaction), so inventing a blocker out of its absence would only ever
   * put a false sentence in front of the appraiser.
   */
  currentFactsHash?: string;
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

export function approvalGate(input: GateInput, options?: GateOptions): GateResult {
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

  // Rating-scale definitions (Slice 7): gated only when the snapshot carries
  // the key — legacy drafts (pre-preset) stay approvable unchanged.
  if (input.provenance?.featureDefs != null) {
    const fd = input.provenance.featureDefs;
    const s = sourced("featureDefs", fd.source, fd.status);
    if (isBlocking(s)) {
      blockers.push({
        path: "provenance.featureDefs",
        label: `Definicje skali ocen — ${statusLabel(fd.status)}.`,
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

  // Prose (FR-6 / ADR-014): no operat leaves without descriptions the
  // appraiser has read and accepted. Kept LAST so the pre-FR-6 groups keep
  // owning `blockers[0]` — the action shows only the first one.
  //
  // Every one of the six sections is required, not just the ones today's
  // facts could back: a section the automat skips (no inspection note) is
  // one the appraiser writes by hand, and step 6 offers all six editors.
  // A blank field is a conscious "this is not in the operat" (it REMOVES
  // the section, see `confirmProseSnapshot`) — and the gate must see that
  // as an unfilled section, because the document would print nothing there.
  if (options?.requireProse) {
    if (!input.prose) {
      blockers.push({ path: "prose", label: "Opisy sekcji nie zostały wygenerowane." });
    } else {
      // Staleness (T6 review, I-2). `confirmed` records that the appraiser
      // accepted the text — not WHICH data the text describes. Edit the
      // sample after step 6 and every section stays confirmed while every
      // sentence describes a sample that no longer exists; `uzasadnienie` is
      // literally the result's standing against that sample. The engine's own
      // answer to the same problem is `wr: null` after such an edit (step 5
      // must be redone); this is the prose half of it.
      if (options.currentFactsHash && input.prose.factsHash !== options.currentFactsHash) {
        blockers.push({
          path: "prose.factsHash",
          label:
            "Opisy sekcji opisują wcześniejszą wersję danych — wróć do kroku 6, przejrzyj je i zatwierdź ponownie.",
        });
      }
      for (const section of PROSE_SECTIONS) {
        const entry = input.prose.sections[section];
        const label = PROSE_SECTION_LABEL[section];
        if (!entry?.value?.trim()) {
          // Covers the tampering case too: text deleted (or never written)
          // while the provenance still claims "confirmed".
          blockers.push({ path: `prose.${section}`, label: `${label} — brak tekstu.` });
          continue;
        }
        const status: ProvenanceStatus = entry.provenance?.status ?? "none";
        if (isBlocking(sourced(entry.value, entry.provenance?.source ?? "ai", status))) {
          blockers.push({ path: `prose.${section}`, label: `${label} — ${statusLabel(status)}.` });
        }
      }
    }
  }

  return blockers.length === 0 ? { ok: true } : { ok: false, blockers };
}
