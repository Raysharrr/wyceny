import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { SubjectForm } from "./subject-form";

// The "Pobierz próbę z RCN" button calls a live worker fetch (typically
// 5-10s, worst case ~25s per the worker's own timeouts) — raise the
// platform's function timeout so it never cuts the request off before the
// worker's Polish error message has a chance to surface.
export const maxDuration = 60;

export default async function NewValuationPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  // No `valuationId` (Slice 12 Task 7) — the Stepper renders every step as a
  // disabled span (advisor I6, `wizard-shell.tsx`); `StepHeader` supplies the
  // step-1 title/description that used to live here as an ad-hoc kicker+h1.
  return (
    <WizardShell currentStep={1} maxReachedStep={1}>
      <SubjectForm />
    </WizardShell>
  );
}
