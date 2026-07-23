import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { calculationReady } from "@/domain/wizard";
import type { Valuation } from "@/ports/valuation";
import { ComparablesProvenance, KcsBreakdown } from "../cards";
import { WizardNav } from "../stepper";
import { ConfirmCalculationButton } from "./confirm-calculation-button";

/**
 * Step 5 ("Kalkulacja") — mirrors mockup Screen4 (screens-4-5.jsx:24), minus
 * the educational copy (out of scope). Runs the KCS engine server-side
 * (via KcsBreakdown/ComparablesProvenance) purely for preview; `wr` is only
 * persisted once the appraiser confirms via ConfirmCalculationButton.
 */
export function StepCalculation({ valuation }: { valuation: Valuation }) {
  const inputs = valuation.inputs;
  if (!calculationReady(inputs)) {
    return (
      <>
        <Card>
          <CardContent className="flex flex-col gap-2 pt-6">
            <h2 className="text-sm font-medium text-foreground">Kalkulacja niedostępna</h2>
            <p className="text-sm text-muted-foreground">
              Uzupełnij próbę porównawczą (krok 3. Próba) i cechy z wagami (krok 4. Cechy), aby
              wyliczyć wartość rynkową.
            </p>
          </CardContent>
        </Card>
        <WizardNav valuationId={valuation.id} back={4} />
      </>
    );
  }
  return (
    <>
      {valuation.wr == null ? (
        <p className="text-sm text-amber-600 dark:text-amber-500">
          Dane wejściowe zmieniły się od ostatniej kalkulacji — zatwierdź ponownie, aby zapisać
          kwotę.
        </p>
      ) : null}
      <KcsBreakdown inputs={inputs!} />
      <ComparablesProvenance inputs={inputs!} />
      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button asChild variant="ghost">
          <Link href={`/valuations/${valuation.id}?step=4`}>Wstecz</Link>
        </Button>
        <ConfirmCalculationButton valuationId={valuation.id} confirmed={valuation.wr != null} />
      </div>
    </>
  );
}
