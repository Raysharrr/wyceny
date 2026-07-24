import { Card, CardContent } from "@/components/ui/card";
import { AutoBanner } from "@/components/wizard/auto-banner";
import { FootNav } from "@/components/wizard/foot-nav";
import { calculationReady } from "@/domain/wizard";
import type { Valuation } from "@/ports/valuation";
import { ComparablesProvenance, KcsBreakdown } from "../cards";
import { ConfirmCalculationButton } from "./confirm-calculation-button";

// Mirrors step-features.tsx's FootNav wrFormatter (Task 9) — plain grouped
// digits, no currency symbol baked in, so " zł" can be appended as literal
// text inside the same <b className="num"> run.
const wrFormatter = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 });

/**
 * Step 5 ("Kalkulacja") — mirrors mockup Screen4 (screens-4-5.jsx:24), minus
 * the educational copy (out of scope). Runs the KCS engine server-side
 * (via KcsBreakdown/ComparablesProvenance) purely for preview; `wr` is only
 * persisted once the appraiser confirms via ConfirmCalculationButton.
 */
export function StepCalculation({ valuation }: { valuation: Valuation }) {
  const inputs = valuation.inputs;
  const backHref = `/valuations/${valuation.id}?step=4`;
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
        <FootNav back={{ href: backHref }} mid="—" />
      </>
    );
  }
  const wrFormatted = valuation.wr != null ? `${wrFormatter.format(valuation.wr)} zł` : null;
  return (
    <>
      <AutoBanner>Wynik policzony automatycznie z zatwierdzonej próby i ocen.</AutoBanner>
      {valuation.wr == null ? (
        <AutoBanner kind="warn">
          Dane wejściowe zmieniły się od ostatniej kalkulacji — zatwierdź ponownie, aby zapisać
          kwotę.
        </AutoBanner>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <KcsBreakdown inputs={inputs!} />
        </div>
        <ComparablesProvenance inputs={inputs!} />
      </div>
      <FootNav
        back={{ href: backHref }}
        mid={
          wrFormatted ? (
            <span>
              Wartość rynkowa <b className="num">{wrFormatted}</b>
            </span>
          ) : (
            "—"
          )
        }
      >
        <ConfirmCalculationButton valuationId={valuation.id} confirmed={valuation.wr != null} />
      </FootNav>
    </>
  );
}
