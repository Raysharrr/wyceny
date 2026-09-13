import { validateFeatures } from "@/domain/feature-rules";
import { z } from "zod";
import { valuationFormObject } from "@/lib/valuation-form-schema";

/**
 * Step-scoped validation schemas for the wizard's Server Actions
 * (`./wizard.ts`). Deliberately NOT defined in that file: Next.js requires
 * every export of a "use server" file to be an async function once the file
 * is reachable from a Client Component's import graph — a plain schema
 * object export breaks the build/runtime with "A 'use server' file can only
 * export async functions, found object." (hit when `subject-form.tsx`,
 * Task 6, imports `step1Schema` directly for its RHF resolver). This file
 * carries no "use server" directive, so both `wizard.ts` and client
 * components can import these schemas without tripping that rule.
 *
 * `.pick()` is called on `valuationFormObject` (the plain, unrefined
 * schema), NOT on the refined `valuationFormSchema` — zod v4 throws at
 * runtime when `.pick()` is called on a schema carrying a `.superRefine()`
 * (verified empirically, see valuation-form-schema.ts:119-126).
 */

const step1Object = valuationFormObject.pick({
  address: true,
  area: true,
  subject: true,
  subjectMeta: true,
  kw: true,
  kwMeta: true,
  purpose: true,
  propertyRight: true,
  hasBasement: true,
  kwNumber: true,
  client: true,
});

/**
 * kwNumber is required only on the manual path (no `kw` extract attached) —
 * mirrors `valuationFormSchema`'s own superRefine (valuation-form-schema.ts:161-169).
 */
export const step1Schema = step1Object.superRefine((values, ctx) => {
  if (!values.kw && !values.kwNumber && values.propertyRight !== "spoldzielcze_wlasnosciowe") {
    ctx.addIssue({
      code: "custom",
      path: ["kwNumber"],
      message: "Podaj numer księgi wieczystej.",
    });
  }
});

export const sampleStepSchema = valuationFormObject
  .pick({
    comparables: true,
    sampleMeta: true,
    sampleSelection: true,
    streetView: true,
  })
  .extend({ selectedComparableIds: z.array(z.string().min(1)).optional() });
export const methodSelectionSchema = z.object({
  method: z.enum(["kcs", "pp"]),
  confirm: z.literal(true),
});
const pairwiseCellSchema = z.object({
  rating: z.enum(["gorsza", "przecietna", "lepsza"]).nullable(),
  multiplier: z.number().nullable(),
  overrideReason: z.string().max(1000).optional(),
});
export const featuresStepSchema = valuationFormObject
  .pick({ features: true })
  .extend({
    comparisons: z
      .record(z.string().min(1), z.record(z.string().min(1), pairwiseCellSchema))
      .optional(),
    confirmPairwise: z.boolean().optional(),
    expectedPairwiseBasis: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    for (const issue of validateFeatures(
      data.features.map((f) => ({ ...f, weight: f.weightPct / 100 })),
    )) {
      ctx.addIssue({ code: "custom", path: issue.path.split("."), message: issue.label });
    }
    if ((data.comparisons !== undefined || data.confirmPairwise) && !data.expectedPairwiseBasis)
      ctx.addIssue({
        code: "custom",
        path: ["expectedPairwiseBasis"],
        message: "Odśwież formularz ocen.",
      });
  });

export type Step1Input = z.input<typeof step1Schema>;
export type SampleStepInput = z.input<typeof sampleStepSchema>;
export type FeaturesStepInput = z.input<typeof featuresStepSchema>;
