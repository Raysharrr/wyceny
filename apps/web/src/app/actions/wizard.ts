"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { getSession } from "@/auth/session";
import { valuationRepository } from "@/app/valuations/_deps";
import { step1Schema, sampleStepSchema, featuresStepSchema } from "./wizard-schemas";
import type { Step1Input, SampleStepInput, FeaturesStepInput } from "./wizard-schemas";
import type { KcsInput } from "@/domain/kcs";
import type { InputsProvenance } from "@/domain/provenance";
import {
  assignFeaturesProvenance,
  assignSampleProvenance,
  assignSubjectProvenance,
} from "@/lib/assign-provenance";
import { isEmptySubject } from "@/lib/subject-form";
import { normalizeDefText, type FeatureDefinitions } from "@/domain/feature-presets";
import { normalizeKw } from "@/domain/kw-snapshot";
import { CalculationNotReadyError } from "@/domain/valuation";

/**
 * Server Actions backing the 7-step wizard (Slice 11a, Task 5) — the "use
 * server" layer between the RHF wizard UI (Task 6) and the repo draft
 * mutations from Task 4. Step 1 (createDraft/saveSubjectAction) mirrors
 * `createValuation`'s validation/normalization pipeline (create-valuation.ts)
 * almost exactly, minus comparables/features/computeKcs — those are filled
 * in at steps 3-5, not step 1.
 *
 * The step-scoped schemas (`step1Schema` etc.) live in `./wizard-schemas.ts`,
 * NOT here — a "use server" file may only export async functions once it's
 * reachable from a Client Component's import graph (Task 6's `subject-form.tsx`
 * imports `step1Schema` directly for its RHF resolver); a schema-object export
 * from this file breaks the build/runtime. Re-exported as types only below
 * (erased at compile time, so they don't trip that rule) for callers that
 * imported them from here before the split.
 */

export type { Step1Input, SampleStepInput, FeaturesStepInput };

/**
 * Normalize per-level definitions: trim + collapse whitespace, drop empty
 * levels. Mirrors create-valuation.ts's private helper of the same name (not
 * shared — both are small, private, and pinned to their own action file).
 */
function normalizeDefinitions(defs?: {
  lepsza?: string;
  przecietna?: string;
  gorsza?: string;
}): FeatureDefinitions {
  const out: FeatureDefinitions = {};
  for (const level of ["lepsza", "przecietna", "gorsza"] as const) {
    const t = normalizeDefText(defs?.[level]);
    if (t) out[level] = t;
  }
  return out;
}

/** Shared zod-issue -> Polish-message mapping (mirrors create-valuation.ts:99-110). */
function firstIssueMessage(error: z.ZodError): string {
  const firstIssue = error.issues[0];
  // zod v4's built-in `invalid_type` message is English — only reachable for
  // structurally malformed payloads that bypass the client (the client's
  // resolver already runs this same schema). All other issues carry our own
  // Polish messages and must pass through unchanged.
  const message =
    firstIssue?.code === "invalid_type" ? "Nieprawidłowe dane formularza." : firstIssue?.message;
  return message ?? "Nieprawidłowe dane formularza.";
}

/**
 * Step-1 (Przedmiot) create (Slice 11a): same validation/normalization
 * pipeline as `createValuation`, WITHOUT comparables/features/computeKcs —
 * those arrive at steps 3-5. Always starts `wr: null` (no calculation yet).
 * Returns `{ error }` for recoverable failures; on success `redirect()`
 * throws and never returns.
 */
export async function createDraft(input: Step1Input): Promise<{ error: string } | never> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const parsed = step1Schema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }

  // Normalize the document-sourced KW snapshot once — see
  // create-valuation.ts:normalizedKw for the full rationale (mirrored here).
  const normalizedKw = parsed.data.kw ? normalizeKw(parsed.data.kw) : parsed.data.kw;

  // An untouched "Dane przedmiotu" section still submits a truthy object —
  // treat it as absent so no snapshot/provenance is persisted for data
  // nobody touched (mirrors create-valuation.ts).
  const subjectTouched = !isEmptySubject(parsed.data.subject);
  const effSubject = subjectTouched ? parsed.data.subject : undefined;
  const effSubjectMeta = subjectTouched ? parsed.data.subjectMeta : undefined;

  const provenance = assignSubjectProvenance({
    area: parsed.data.area,
    subject: effSubject,
    subjectMeta: effSubjectMeta,
    kw: parsed.data.kw,
    kwMeta: parsed.data.kwMeta,
  });

  const inputs: KcsInput = {
    area: parsed.data.area,
    comparables: [],
    features: [],
    sampleMeta: null,
    subject: effSubject ?? null,
    subjectMeta: effSubjectMeta ?? null,
    kw: normalizedKw ?? null,
    kwMeta: parsed.data.kwMeta ?? null,
    // Runtime-partial, type-full (advisor BLOCKER-1): weights/ratings arrive
    // at step 4; approvalGate default-denies missing entries, and every
    // unguarded provenance.weights read is reachable only once wr is set
    // (Task 7 gating).
    provenance: provenance as InputsProvenance,
  };

  const created = await valuationRepository.create({
    address: parsed.data.address,
    area: parsed.data.area,
    wr: null,
    inputs,
    amountInWords: null,
    docUrl: null,
    purpose: parsed.data.purpose,
    kwNumber:
      parsed.data.kwNumber?.trim() || normalizedKw?.kwLokalu || normalizedKw?.kwGruntu || null,
    client: parsed.data.client,
    inspectionDate: null,
    ownerId: session.user.id,
  });

  redirect(`/valuations/${created.id}?step=2`);
}

/** Step-1 (Przedmiot) draft save — same validation/normalization pipeline as `createDraft`. */
export async function saveSubjectAction(
  valuationId: string,
  input: Step1Input,
): Promise<{ error: string } | { ok: true }> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const parsed = step1Schema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }

  const normalizedKw = parsed.data.kw ? normalizeKw(parsed.data.kw) : parsed.data.kw;
  const subjectTouched = !isEmptySubject(parsed.data.subject);
  const effSubject = subjectTouched ? parsed.data.subject : undefined;
  const effSubjectMeta = subjectTouched ? parsed.data.subjectMeta : undefined;

  const provenance = assignSubjectProvenance({
    area: parsed.data.area,
    subject: effSubject,
    subjectMeta: effSubjectMeta,
    kw: parsed.data.kw,
    kwMeta: parsed.data.kwMeta,
  });

  try {
    const updated = await valuationRepository.saveSubject(valuationId, session.user, {
      address: parsed.data.address,
      area: parsed.data.area,
      purpose: parsed.data.purpose,
      kwNumber:
        parsed.data.kwNumber?.trim() || normalizedKw?.kwLokalu || normalizedKw?.kwGruntu || null,
      client: parsed.data.client,
      subject: effSubject ?? null,
      subjectMeta: effSubjectMeta ?? null,
      kw: normalizedKw ?? null,
      kwMeta: parsed.data.kwMeta ?? null,
      provenance,
    });
    if (!updated) {
      return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
    }
  } catch (error) {
    console.error("saveSubjectAction failed", error);
    return { error: "Nie udało się zapisać danych — spróbuj ponownie." };
  }
  revalidatePath(`/valuations/${valuationId}`);
  return { ok: true };
}

/**
 * Step-3 (Próba) draft save. Comparables pass through
 * `assignSampleProvenance` unchanged — unlike features, the sample carries no
 * percentage-to-fraction conversion.
 */
export async function saveSampleAction(
  valuationId: string,
  input: SampleStepInput,
): Promise<{ error: string } | { ok: true }> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const parsed = sampleStepSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }

  const { comparables, geocode } = assignSampleProvenance(parsed.data);

  try {
    const updated = await valuationRepository.saveSample(valuationId, session.user, {
      comparables,
      sampleMeta: parsed.data.sampleMeta ?? null,
      geocode,
    });
    if (!updated) {
      return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
    }
  } catch (error) {
    console.error("saveSampleAction failed", error);
    return { error: "Nie udało się zapisać próby — spróbuj ponownie." };
  }
  revalidatePath(`/valuations/${valuationId}`);
  return { ok: true };
}

/**
 * Step-4 (Cechy) draft save. `weightPct` -> fraction (mirrors
 * `createValuation`'s kcsInput.features mapping). The preset-detection
 * provenance fragment is computed from the comparables ALREADY saved on the
 * draft (repo.get) — this step's own input carries no comparables.
 *
 * ponytail: median read outside the row lock — a concurrent sample edit
 * skews only the preset-detection heuristic, not data.
 */
export async function saveFeaturesAction(
  valuationId: string,
  input: FeaturesStepInput,
): Promise<{ error: string } | { ok: true }> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const parsed = featuresStepSchema.safeParse(input);
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }

  const current = await valuationRepository.get(valuationId, session.user);
  if (!current) {
    return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
  }

  const provenance = assignFeaturesProvenance(
    parsed.data.features,
    (current.inputs?.comparables ?? []).map((c) => c.area),
  );
  const features = parsed.data.features.map((f) => ({
    name: f.name,
    weight: f.weightPct / 100,
    rating: f.rating,
    key: f.key,
    definitions: normalizeDefinitions(f.definitions),
  }));

  try {
    const updated = await valuationRepository.saveFeatures(valuationId, session.user, {
      features,
      provenance,
    });
    if (!updated) {
      return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
    }
  } catch (error) {
    console.error("saveFeaturesAction failed", error);
    return { error: "Nie udało się zapisać cech — spróbuj ponownie." };
  }
  revalidatePath(`/valuations/${valuationId}`);
  return { ok: true };
}

/** Step-5 (Kalkulacja) confirm — runs the KCS engine server-side and persists `wr`. */
export async function confirmCalculationAction(
  valuationId: string,
): Promise<{ error: string } | { ok: true }> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  try {
    const updated = await valuationRepository.confirmCalculation(valuationId, session.user);
    if (!updated) {
      return { error: "Nie znaleziono wyceny albo nie masz do niej dostępu." };
    }
  } catch (error) {
    if (error instanceof CalculationNotReadyError) {
      return { error: "Uzupełnij próbę (krok 3) i cechy (krok 4)." };
    }
    console.error("confirmCalculationAction failed", error);
    return { error: "Nie udało się potwierdzić kalkulacji — spróbuj ponownie." };
  }
  revalidatePath(`/valuations/${valuationId}`);
  return { ok: true };
}
