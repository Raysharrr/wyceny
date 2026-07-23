"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { saveInspectionDate } from "@/app/actions/inspection";
import type { InspectionSnapshot } from "@/domain/inspection";
import { InspectionSection } from "../inspection-section";
import { WizardNav } from "../stepper";

/**
 * Step 2 ("Oględziny") — photo sections + note already live in
 * InspectionSection (Slice 10, FR-2), unchanged here. This step's own
 * addition (Slice 11a) is the inspection-date field, moved out of the old
 * single-page form's header per the approved spec — saved independently via
 * `saveInspectionDate` (Task 5), same debounce-on-blur pattern as the rest
 * of the wizard's per-field saves.
 */
export function StepInspection({
  valuationId,
  inspection,
  inspectionDate,
}: {
  valuationId: string;
  inspection: InspectionSnapshot | null;
  inspectionDate: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Card>
        <CardContent className="flex max-w-xs flex-col gap-2 pt-6">
          <Field>
            <FieldLabel htmlFor="inspectionDate">Data oględzin</FieldLabel>
            <Input
              id="inspectionDate"
              type="date"
              defaultValue={inspectionDate ?? ""}
              onBlur={async (e) => {
                setError(null);
                const result = await saveInspectionDate(valuationId, e.target.value);
                if (result?.error) setError(result.error);
                else router.refresh();
              }}
            />
          </Field>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>
      <InspectionSection valuationId={valuationId} inspection={inspection} />
      <WizardNav valuationId={valuationId} back={1} next={3} />
    </>
  );
}
