import Link from "next/link";
import { FileEdit } from "lucide-react";
import { FootNav } from "@/components/wizard/foot-nav";
import { SectionCard } from "@/components/wizard/section-card";

/**
 * Step 6 ("Opisy") — FR-6 prose generator is out of scope for 11a (spec
 * decision). Placeholder card explaining the current deterministic
 * template-based behaviour; approval still produces the operat as before.
 */
export function StepDescriptions({ valuationId }: { valuationId: string }) {
  return (
    <>
      <SectionCard icon={FileEdit} title="Opisy">
        <p className="text-sm text-muted-foreground">
          Generator prozy sekcji opisowych (FR-6) — w przygotowaniu. Opisy operatu powstają na razie
          deterministycznie z szablonu przy zatwierdzeniu.
        </p>
      </SectionCard>
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
