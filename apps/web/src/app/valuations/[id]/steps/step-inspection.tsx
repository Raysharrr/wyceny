"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { saveInspectionDate } from "@/app/actions/inspection";
import { FootNav } from "@/components/wizard/foot-nav";
import { totalInspectionPhotos, type InspectionSnapshot } from "@/domain/inspection";
import { InspectionSection } from "../inspection-section";

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
      <FootNav
        back={{ href: `/valuations/${valuationId}?step=1` }}
        mid={
          <>
            Oględziny: <b>{totalInspectionPhotos(inspection)} zdjęć</b>
          </>
        }
      >
        <Link
          href={`/valuations/${valuationId}?step=3`}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-[14.5px] font-medium text-primary-foreground shadow-sm hover:bg-[var(--accent-700)]"
        >
          Dalej
        </Link>
      </FootNav>
    </>
  );
}
