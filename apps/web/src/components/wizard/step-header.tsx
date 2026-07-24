import { STEP_META } from "./step-meta";

export function StepHeader({ step }: { step: keyof typeof STEP_META }) {
  const m = STEP_META[step];
  return (
    <div className="mb-5">
      <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-[.06em] text-[var(--accent-700)]">
        {m.eyebrow}
      </p>
      <h1 className="mb-1.5 text-[25px] font-semibold tracking-[-0.015em]">{m.title}</h1>
      <p className="max-w-[70ch] text-[14.5px] text-muted-foreground">{m.description}</p>
    </div>
  );
}
