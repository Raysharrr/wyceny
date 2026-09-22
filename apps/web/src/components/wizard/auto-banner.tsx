import { CircleAlert, Info, Sparkles, TriangleAlert } from "lucide-react";

// Variants (spec §12a): info = data from the automat, note = neutral status or
// hint, warn = needs the appraiser's attention, error = a failed operation.
// `note`/`error` tint with the token at low opacity rather than mock-ds.css's
// `color-mix(…, #fff)`: over the light card it is the same colour, and it
// stays dark in the dark theme, where `#fff` would turn the banner white.
const VARIANT = {
  info: {
    icon: Sparkles,
    className: "border-[var(--accent-100)] bg-[var(--accent-050)] text-[var(--accent-700)]",
  },
  note: { icon: Info, className: "border-brand-blue/20 bg-brand-blue/7 text-brand-blue" },
  warn: {
    icon: TriangleAlert,
    className: "border-[var(--amber-line)] bg-[var(--amber-bg)] text-[var(--amber)]",
  },
  error: {
    icon: CircleAlert,
    className: "border-destructive/25 bg-destructive/8 text-destructive",
  },
} as const;

export function AutoBanner({
  children,
  kind = "info",
  action,
}: {
  children: React.ReactNode;
  kind?: keyof typeof VARIANT;
  /** A control that belongs to the message, set flush right (mockup 8: „Przywróć progi z presetu”). */
  action?: React.ReactNode;
}) {
  const { icon: Icon, className } = VARIANT[kind];
  return (
    <div
      data-kind={kind}
      role={kind === "error" ? "alert" : "status"}
      className={
        "flex items-center gap-3 rounded-lg border px-4 py-3 text-[13.5px] font-medium " + className
      }
    >
      <Icon className="size-5 shrink-0" />
      <span>{children}</span>
      {action ? <span className="ml-auto shrink-0">{action}</span> : null}
    </div>
  );
}
