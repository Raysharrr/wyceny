import Link from "next/link";

export function FootNav({
  back,
  mid,
  children,
}: {
  back?: { href: string; label?: string };
  mid?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-[color-mix(in_oklab,var(--muted)_90%,transparent)] backdrop-blur">
      <div className="mx-auto flex max-w-[1240px] items-center gap-3.5 px-6 py-3.5">
        {back ? (
          <Link
            href={back.href}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            ← {back.label ?? "Wstecz"}
          </Link>
        ) : (
          <span className="w-24" />
        )}
        <div className="flex flex-1 items-center justify-center gap-3 text-[12.5px] text-muted-foreground [&_b]:font-semibold [&_b]:text-foreground">
          {mid}
        </div>
        {children ?? <span className="w-24" />}
      </div>
    </div>
  );
}
