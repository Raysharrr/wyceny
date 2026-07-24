import { Sparkles, TriangleAlert } from "lucide-react";

export function AutoBanner({
  children,
  kind = "info",
}: {
  children: React.ReactNode;
  kind?: "info" | "warn";
}) {
  const warn = kind === "warn";
  return (
    <div
      data-kind={kind}
      className={
        "flex items-center gap-3 rounded-lg border px-4 py-3 text-[13.5px] font-medium " +
        (warn
          ? "border-[var(--amber-line)] bg-[var(--amber-bg)] text-[var(--amber)]"
          : "border-[var(--accent-100)] bg-[var(--accent-050)] text-[var(--accent-700)]")
      }
    >
      {warn ? (
        <TriangleAlert className="size-5 shrink-0" />
      ) : (
        <Sparkles className="size-5 shrink-0" />
      )}
      <span>{children}</span>
    </div>
  );
}
