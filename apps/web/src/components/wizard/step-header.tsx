import Link from "next/link";
import { CircleQuestionMark } from "lucide-react";
import { getPage } from "@/content/pomoc/manifest";
import { STEP_META } from "./step-meta";

export function StepHeader({ step }: { step: keyof typeof STEP_META }) {
  const m = STEP_META[step];
  // Zero dead links (Slice 12): the icon appears only once this step's Pomoc
  // page is really in the manifest. Tasks 7-8 add the seven pages one at a
  // time, so in between some steps have the entry point and some don't.
  const helpHref = getPage(m.helpSlug) ? `/pomoc/${m.helpSlug}` : undefined;
  return (
    <div className="mb-5">
      <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-[.06em] text-[var(--accent-700)]">
        {m.eyebrow}
      </p>
      <div className="mb-1.5 flex items-start justify-between gap-3">
        <h1 className="text-[25px] font-semibold tracking-[-0.015em]">{m.title}</h1>
        {helpHref && (
          <Link
            href={helpHref}
            aria-label="Pomoc — ten krok"
            className="mt-1.5 shrink-0 text-muted-foreground transition-colors hover:text-[var(--accent-700)]"
          >
            <CircleQuestionMark className="h-[18px] w-[18px]" aria-hidden="true" />
          </Link>
        )}
      </div>
      <p className="max-w-[70ch] text-[14.5px] text-muted-foreground">{m.description}</p>
    </div>
  );
}
