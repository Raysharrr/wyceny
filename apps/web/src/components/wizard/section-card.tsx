import type { LucideIcon } from "lucide-react";

/**
 * Shared visual wrapper for wizard content sections (Task 12 — section-card
 * parity with the mockup). RSC-safe (no hooks): every wizard step, client or
 * server, can wrap its existing content blocks in this without becoming a
 * client component itself.
 */
export function SectionCard({
  icon: Icon,
  title,
  sub,
  right,
  children,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  sub?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={"rounded-[14px] border border-border bg-card shadow-sm " + (className ?? "")}
    >
      <header className="flex items-center gap-3 border-b border-border px-5 py-3.5">
        {Icon ? <Icon className="size-[17px] text-muted-foreground" /> : null}
        <h3 className="text-[14.5px] font-semibold">{title}</h3>
        {sub ? <span className="text-[12.5px] text-muted-foreground">{sub}</span> : null}
        {right ? <span className="ml-auto">{right}</span> : null}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}
