"use client";

import * as React from "react";
import { Upload } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Styled replacement for the bare native `<input type="file">`, which renders
 * as plain text and gives no affordance that it is clickable. The real input
 * stays in the DOM (sr-only) so form semantics (`name=`), refs, testids and
 * assistive tech keep working — the visible surface is a label styled as a
 * dashed drop-area with a real-looking button.
 */
function FileInput({
  className,
  label = "Wybierz plik",
  hint,
  showSelected = true,
  onChange,
  disabled,
  ...props
}: React.ComponentProps<"input"> & {
  /** Text on the faux button, e.g. "Wybierz plik PDF". */
  label?: string;
  /** Muted helper shown until a file is picked, e.g. accepted formats. */
  hint?: string;
  /** Hide picked-file names (for flows with their own preview UI). */
  showSelected?: boolean;
}) {
  const [picked, setPicked] = React.useState<string | null>(null);

  return (
    <label
      className={cn(
        "flex w-fit max-w-full cursor-pointer items-center gap-3 rounded-lg border border-dashed border-input bg-muted/40 py-2 pr-4 pl-2 transition-colors",
        "hover:border-ring/60 hover:bg-muted",
        "has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      <span
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-none")}
      >
        <Upload data-icon="inline-start" />
        {label}
      </span>
      <span className="min-w-0 truncate text-sm text-muted-foreground">
        {(showSelected && picked) || hint || "Nie wybrano pliku"}
      </span>
      <input
        type="file"
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          const files = e.target.files;
          setPicked(
            files && files.length > 1
              ? `Wybrano pliki: ${files.length}`
              : (files?.[0]?.name ?? null),
          );
          onChange?.(e);
        }}
        {...props}
      />
    </label>
  );
}

export { FileInput };
