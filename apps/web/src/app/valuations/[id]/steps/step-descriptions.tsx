import { Card, CardContent } from "@/components/ui/card";
import { WizardNav } from "../stepper";

/**
 * Step 6 ("Opisy") — FR-6 prose generator is out of scope for 11a (spec
 * decision). Placeholder card explaining the current deterministic
 * template-based behaviour; approval still produces the operat as before.
 */
export function StepDescriptions({ valuationId }: { valuationId: string }) {
  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-2 pt-6">
          <h2 className="text-sm font-medium text-foreground">Opisy</h2>
          <p className="text-sm text-muted-foreground">
            Generator prozy sekcji opisowych (FR-6) — w przygotowaniu. Opisy operatu powstają na
            razie deterministycznie z szablonu przy zatwierdzeniu.
          </p>
        </CardContent>
      </Card>
      <WizardNav valuationId={valuationId} back={5} next={7} />
    </>
  );
}
