import { Stepper } from "@/app/valuations/[id]/stepper";
import { StepHeader } from "./step-header";
import type { STEP_META } from "./step-meta";

/**
 * Chrome for the `[id]` wizard branch (Task 5): sticky Stepper + the
 * page-level StepHeader, wrapping whichever step component the caller
 * renders as `children`. `valuationId` is optional — undefined puts the
 * Stepper in create-mode (advisor I6), a future caller with no id yet.
 */
export function WizardShell({
  currentStep,
  maxReachedStep,
  valuationId,
  children,
}: {
  currentStep: number;
  maxReachedStep: number;
  valuationId?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <Stepper current={currentStep} maxReached={maxReachedStep} valuationId={valuationId} />
      <main className="px-6 pb-32 pt-7">
        <div className="mx-auto w-full max-w-[1240px]">
          <StepHeader step={currentStep as keyof typeof STEP_META} />
          {children}
        </div>
      </main>
    </>
  );
}
