"use client";

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LEVEL_LABEL } from "@/domain/feature-presets";
import type { FeatureRating } from "@/domain/kcs";
import { cn } from "@/lib/utils";

/** Scale order on screen, lowest first — the cards read left to right like the scale. */
export const SCALE_LEVELS: FeatureRating[] = ["gorsza", "przecietna", "lepsza"];

// Level cards mirror the option tiles of `new/kw-section.tsx` (TILE, TILE_SELECTED).
export const TILE =
  "h-auto flex-col items-start gap-0.5 whitespace-normal rounded-lg px-4 py-3 text-left";
export const TILE_SELECTED = "border-primary bg-[var(--accent-050)]";
export const TILE_IDLE = "border-border";

/**
 * Mockup `FeatureRatingGroup` — the described levels as one radio group.
 * Follows the ARIA radio-group pattern: one tab stop (the selected tile, or the
 * first one while nothing is selected) and arrows/Home/End move the selection.
 */
export function FeatureRatingGroup({
  label,
  levels,
  definitions,
  rating,
  onSelect,
  compact = false,
}: {
  label: string;
  levels: FeatureRating[];
  definitions: Partial<Record<FeatureRating, string>> | undefined;
  rating: FeatureRating | null;
  onSelect: (level: FeatureRating) => void;
  /** Karta lokali skrajnych (ADR-022): kafelek bez definicji, ciaśniejszy — skalę opisuje wiersz cechy wyżej. */
  compact?: boolean;
}) {
  const selectedIndex = rating ? levels.indexOf(rating) : -1;
  const focusedIndex = selectedIndex < 0 ? 0 : selectedIndex;

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const last = levels.length - 1;
    if (last < 0) return;
    const tiles = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
    const from = Math.max(tiles.indexOf(document.activeElement as HTMLElement), focusedIndex);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    // Arrows wrap around the group, Home/End jump to its ends (ARIA pattern).
    const next =
      step !== undefined
        ? (from + step + levels.length) % levels.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? last
            : null;
    if (next === null) return;
    event.preventDefault();
    onSelect(levels[next]);
    tiles[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex flex-wrap gap-2"
      onKeyDown={onKeyDown}
    >
      {levels.map((level, index) => (
        <Button
          key={level}
          type="button"
          role="radio"
          aria-checked={level === rating}
          tabIndex={index === focusedIndex ? 0 : -1}
          variant="outline"
          onClick={() => onSelect(level)}
          className={cn(
            TILE,
            compact ? "flex-[1_1_9rem] px-3 py-2" : "flex-[1_1_13rem]",
            level === rating ? TILE_SELECTED : TILE_IDLE,
            rating == null && "bg-card",
          )}
        >
          <span className="text-sm font-medium text-foreground">
            {LEVEL_LABEL[level]}
            {level === rating ? (
              <Check className="ml-1 inline-block size-3.5 align-[-2px] text-primary" />
            ) : null}
          </span>
          {compact ? null : (
            <span className="text-xs font-normal text-muted-foreground">
              {definitions?.[level] ?? ""}
            </span>
          )}
        </Button>
      ))}
    </div>
  );
}
