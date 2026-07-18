"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { valuationRepository } from "@/app/valuations/_deps";
import { valuationFormSchema, type ValuationFormValues } from "@/lib/valuation-form-schema";
import { computeKcs, type KcsInput } from "@/domain/kcs";
import { assignProvenance } from "@/lib/assign-provenance";
import { isEmptySubject } from "@/lib/subject-form";

export type CreateValuationInput = ValuationFormValues;

export type CreateValuationResult = { error: string } | undefined;

type KwSnapshot = NonNullable<ValuationFormValues["kw"]>;
type KwDzial = NonNullable<KwSnapshot["dzial3"]>;

/** ""/whitespace → null; otherwise the trimmed string. */
function trimToNull(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Drops empty/whitespace-only entries; keeps `wpisy` untouched (see below). */
function normalizeDzial(dzial: KwDzial | null): KwDzial | null {
  if (dzial == null) return dzial;
  // Deliberately DO NOT flip `wpisy` to false when the filtered `tresc` is
  // empty: that would fabricate a "brak wpisów" (clean-title/no-mortgage)
  // claim. The document model renders neither the brak sentence nor the loop
  // when `wpisy` is true but `tresc` is [] — acceptable honest silence.
  return {
    wpisy: dzial.wpisy,
    tresc: dzial.tresc.map((t) => t.trim()).filter((t) => t.length > 0),
  };
}

/**
 * Normalizes a document-sourced KW snapshot at the action boundary (mirrors
 * the `isEmptySubject` convention): empty-string fields the extractor may emit
 * become `null`, and empty/whitespace `tresc`/`kwInne` lines are dropped — so
 * a `""` never persists to render malformed operat sentences (e.g. "Sąd: .")
 * or a phantom KW number, and the F-4 gate sees honest nulls.
 */
function normalizeKw(kw: KwSnapshot): KwSnapshot {
  return {
    ...kw,
    kwLokalu: trimToNull(kw.kwLokalu),
    kwGruntu: trimToNull(kw.kwGruntu),
    udzial: trimToNull(kw.udzial),
    sad: trimToNull(kw.sad),
    wydzial: trimToNull(kw.wydzial),
    dataDokumentu: trimToNull(kw.dataDokumentu),
    kwInne: kw.kwInne.map((s) => s.trim()).filter((s) => s.length > 0),
    dzial3: normalizeDzial(kw.dzial3),
    dzial4: normalizeDzial(kw.dzial4),
  };
}

/**
 * Server Action backing `valuations/new` (Task 9 — the E2E climax). Crosses
 * every boundary built so far: session (T6) → PortValuation/Postgres (T5),
 * with ownership isolation (T7) applied on every later read. KCS Task 4
 * makes the engine live: the shared schema is the authoritative re-check
 * (same rules as the client resolver, Task 3), and `computeKcs` now
 * computes the WR.
 *
 * Document generation (worker `amountInWords` + storage write) was removed
 * here in Slice 4 — a draft has no document artifacts. Those are produced
 * at APPROVAL time instead (spec §3), so `amountInWords`/`docUrl`/`docxUrl`
 * are always `null` on create.
 *
 * Returns `{ error }` for recoverable failures (bad input) so the client
 * form can show a Polish message. On success it never returns —
 * `redirect()` throws, which must propagate uncaught.
 */
export async function createValuation(input: CreateValuationInput): Promise<CreateValuationResult> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  // Authoritative validation — same schema as the client resolver.
  const parsed = valuationFormSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    // zod v4's built-in `invalid_type` message is English ("Invalid input:
    // expected string, received number") — only reachable for structurally
    // malformed payloads that bypass the client (adversarial input, since
    // the client's resolver already runs this same schema). All other
    // issues carry our own Polish messages (see valuation-form-schema.ts)
    // and must pass through unchanged.
    const message =
      firstIssue?.code === "invalid_type" ? "Nieprawidłowe dane formularza." : firstIssue?.message;
    return { error: message ?? "Nieprawidłowe dane formularza." };
  }
  const {
    address,
    area,
    features,
    sampleMeta,
    subject,
    subjectMeta,
    kw,
    kwMeta,
    purpose,
    kwNumber,
    client,
    inspectionDate,
  } = parsed.data;

  // Normalize the document-sourced KW snapshot once (""-fields → null, empty
  // tresc/kwInne lines dropped) so every downstream consumer — the persisted
  // kcsInput.kw, the kwNumber column sync, the F-4 gate — sees the same honest
  // shape. `assignProvenance` reads only source/powUzytkowaKw, so it is
  // unaffected by this and keeps receiving `parsed.data.kw`.
  const normalizedKw = kw ? normalizeKw(kw) : kw;

  // An untouched "Dane przedmiotu" section still submits a truthy object
  // (RHF seeds `defaultValues.subject` with `EMPTY_SUBJECT`) — treat it as
  // absent so no snapshot/provenance is persisted for data nobody touched.
  const subjectTouched = !isEmptySubject(subject);
  const effectiveSubject = subjectTouched ? subject : undefined;
  const effectiveSubjectMeta = subjectTouched ? subjectMeta : undefined;

  // Assign provenance statuses server-side: rcn rows get to_verify, manual
  // rows get confirmed. This is the ACL of ADR-010 — statuses are born here,
  // server-side only, never trusted from the client. % → fractions at the
  // action boundary; the engine works in fractions. `sampleMeta` is normalized
  // to `null` when absent so every stored snapshot has the same shape
  // (manual-only submissions vs. RCN-seeded ones).
  const { comparables: sourcedComparables, provenance } = assignProvenance({
    ...parsed.data,
    subject: effectiveSubject,
    subjectMeta: effectiveSubjectMeta,
  });
  const kcsInput: KcsInput = {
    area,
    comparables: sourcedComparables,
    features: features.map((f) => ({ name: f.name, weight: f.weightPct / 100, rating: f.rating })),
    sampleMeta: sampleMeta ?? null,
    subject: effectiveSubject ?? null,
    subjectMeta: effectiveSubjectMeta ?? null,
    // Normalized to null when absent, like subject/subjectMeta, so every
    // stored snapshot has the same shape (manual-only vs. kw-extract-seeded).
    kw: normalizedKw ?? null,
    kwMeta: kwMeta ?? null,
    provenance,
  };
  const { wr } = computeKcs(kcsInput);

  const created = await valuationRepository.create({
    address,
    area,
    wr,
    inputs: kcsInput,
    // Document artifacts are generated at APPROVAL (spec §3) — a draft has none.
    amountInWords: null,
    docUrl: null,
    docxUrl: null,
    purpose,
    // kwNumber column sync: prefer the appraiser's manual entry (trimmed);
    // otherwise fall back to the document-sourced KW numbers (lokal, then
    // grunt). Can still be `null` — an extract with both KW numbers null
    // yields no fallback either, and the column is nullable; approval is
    // gated separately by `documentFieldBlockers`/the F-4 kw checks, not by
    // this sync.
    kwNumber: kwNumber?.trim() || normalizedKw?.kwLokalu || normalizedKw?.kwGruntu || null,
    client,
    inspectionDate,
    ownerId: session.user.id,
  });

  redirect(`/valuations/${created.id}`);
}
