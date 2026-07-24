import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { FootNav } from "@/components/wizard/foot-nav";

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
      <FootNav
        back={{ href: `/valuations/${valuationId}?step=5` }}
        mid="Opisy z szablonu przy zatwierdzeniu"
      >
        <Link
          href={`/valuations/${valuationId}?step=7`}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-[14.5px] font-medium text-primary-foreground shadow-sm hover:bg-[var(--accent-700)]"
        >
          Dalej
        </Link>
      </FootNav>
    </>
  );
}
