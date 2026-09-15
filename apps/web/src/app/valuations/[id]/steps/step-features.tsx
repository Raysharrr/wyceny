"use client";

import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Calculator, Check, Scale, SlidersHorizontal } from "lucide-react";
import { Controller, useFieldArray, useForm, useWatch, type Control } from "react-hook-form";
import { useRouter } from "next/navigation";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { saveFeaturesAction } from "@/app/actions/wizard";
import { featuresStepSchema } from "@/app/actions/wizard-schemas";
import {
  FEATURE_PRESETS,
  LEVEL_LABEL,
  medianAreaM2,
  powierzchniaDefinitions,
  type LokalFeatureKey,
} from "@/domain/feature-presets";
import {
  computeKcsOnScale,
  describedLevels,
  featureIssues,
  featureUis,
} from "@/domain/feature-rules";
import type { Comparable, FeatureRating, KcsInput } from "@/domain/kcs";
import { cn } from "@/lib/utils";
import { DEFAULT_FEATURES } from "@/lib/valuation-form-schema";
import { FootNav } from "@/components/wizard/foot-nav";
import { SectionCard } from "@/components/wizard/section-card";

type FormInput = z.input<typeof featuresStepSchema>;
type FormOutput = z.output<typeof featuresStepSchema>;

/** Scale order on screen, lowest first — the cards read left to right like the scale. */
const SCALE_LEVELS: FeatureRating[] = ["gorsza", "przecietna", "lepsza"];

// Level cards mirror the option tiles of `new/kw-section.tsx` (TILE, TILE_SELECTED).
const TILE = "h-auto flex-col items-start gap-0.5 whitespace-normal rounded-lg px-4 py-3 text-left";
const TILE_SELECTED = "border-primary bg-[var(--accent-050)]";
const TILE_IDLE = "border-border";

const numberFormatter = new Intl.NumberFormat("pl-PL", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Sidebar/FootNav formatters (Task 9 — live KCS preview). Ui, ΣUi and the V
// ratios all print at three decimals, the precision the engine rounds them to.
const sumUiFormatter = new Intl.NumberFormat("pl-PL", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});
const unitPriceFormatter = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" });
const wrFormatter = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 });

// zod's coerced-number fields (`z.coerce.number()`) have an `input` type of
// `unknown` — so RHF's `field.value` for weight is typed `unknown`, not
// `string`. This turns it into the string an <input> needs, without
// stringifying `undefined`/`null` into the literal words "undefined"/"null".
// Mirrors `new-valuation-form.tsx` / `step-sample.tsx`.
function toInputValue(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

/**
 * Builds `useForm`'s `defaultValues.features` from the persisted draft (or
 * `DEFAULT_FEATURES` for a fresh valuation) — fractions convert to %
 * (`saveFeaturesAction` does the reverse on save). The powierzchnia-uzytkowa
 * median seed (Slice 7 UX) runs ONCE here rather than the old form's
 * live-tracking effect: comparables are a FROZEN prop on this step (no
 * sample table to react to), so an empty definition just gets the current
 * median baked in up front; an already-filled one is left untouched.
 */
function buildDefaultFeatures(
  features: KcsInput["features"],
  comparableAreas: Array<number | undefined>,
): FormInput["features"] {
  const mapped: FormInput["features"] = features.length
    ? features.map((f) => ({
        key: f.key as LokalFeatureKey,
        name: f.name,
        weightPct: Math.round(f.weight * 10000) / 100,
        rating: f.rating,
        definitions: {
          lepsza: f.definitions?.lepsza ?? "",
          przecietna: f.definitions?.przecietna ?? "",
          gorsza: f.definitions?.gorsza ?? "",
        },
      }))
    : DEFAULT_FEATURES;

  const median = medianAreaM2(comparableAreas);
  return mapped.map((f) =>
    f.key === "powierzchnia-uzytkowa" && !f.definitions?.lepsza && !f.definitions?.gorsza
      ? { ...f, definitions: { ...f.definitions, ...powierzchniaDefinitions(median) } }
      : f,
  );
}

/** Mockup `FeatureRatingList` — the rows span the whole card, edge to edge. */
function FeatureRatingList({ children }: { children: React.ReactNode }) {
  return <div className="-mx-5 -mb-5 -mt-5 flex flex-col">{children}</div>;
}

/** Mockup `FeatureRatingRow` — one feature; amber until it has a rating. */
function FeatureRatingRow({
  featureKey,
  name,
  rated,
  meta,
  children,
}: {
  featureKey: string | undefined;
  name: string;
  rated: boolean;
  meta: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid={`feature-row-${featureKey}`}
      data-rated={rated}
      className={cn(
        "flex flex-col gap-3 border-t border-border px-5 py-4 first:border-t-0",
        !rated && "bg-[var(--amber-bg)]",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="text-sm font-medium">{name}</span>
        <span className="flex flex-wrap items-center gap-3 text-[12.5px] text-muted-foreground">
          {meta}
        </span>
      </div>
      {children}
    </div>
  );
}

/**
 * Mockup `FeatureRatingGroup` — the described levels as one radio group.
 * Follows the ARIA radio-group pattern: one tab stop (the selected tile, or the
 * first one while nothing is selected) and arrows/Home/End move the selection.
 */
function FeatureRatingGroup({
  label,
  levels,
  definitions,
  rating,
  onSelect,
}: {
  label: string;
  levels: FeatureRating[];
  definitions: Partial<Record<FeatureRating, string>> | undefined;
  rating: FeatureRating | null;
  onSelect: (level: FeatureRating) => void;
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
            "flex-[1_1_13rem]",
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
          <span className="text-xs font-normal text-muted-foreground">
            {definitions?.[level] ?? ""}
          </span>
        </Button>
      ))}
    </div>
  );
}

/** The level definitions of one feature, edited under „Edytuj skalę”. */
function ScaleEditor({
  control,
  index,
  featureKey,
  rating,
  onSelectedLevelCleared,
}: {
  control: Control<FormInput, unknown, FormOutput>;
  index: number;
  featureKey: string | undefined;
  rating: FeatureRating | null | undefined;
  onSelectedLevelCleared: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {SCALE_LEVELS.map((level) => (
        <Controller
          key={level}
          control={control}
          name={`features.${index}.definitions.${level}`}
          render={({ field: defField }) => (
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">{LEVEL_LABEL[level]}</span>
              <Input
                data-testid={`feature-def-${featureKey ?? index}-${level}`}
                placeholder="puste pole — poziom nie pojawi się w operacie"
                name={defField.name}
                onBlur={defField.onBlur}
                ref={defField.ref}
                value={toInputValue(defField.value)}
                onChange={(e) => {
                  defField.onChange(e.target.value);
                  // A rating on a level that no longer has a description is
                  // off the scale (ADR-016 reg. 4) — the appraiser picks again.
                  if (rating === level && e.target.value.trim() === "") onSelectedLevelCleared();
                }}
              />
            </label>
          )}
        />
      ))}
    </div>
  );
}

/**
 * Step 4 ("Cechy") — every feature as a row of cards for its DESCRIBED levels
 * (ADR-016, mockup `p5-propozycja-krok4`). No rating by default; ΣUi and the
 * WR preview wait for the full set. Own `useForm` scoped to
 * `featuresStepSchema`. Submit saves via `saveFeaturesAction` and advances to
 * step 5.
 */
export function StepFeatures({
  valuationId,
  features: initialFeatures,
  comparables,
  area,
}: {
  valuationId: string;
  features: KcsInput["features"];
  comparables: Comparable[];
  area: number;
}) {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [editingScale, setEditingScale] = useState<Record<string, boolean>>({});
  const comparableAreas = comparables.map((c) => c.area);

  const {
    control,
    handleSubmit,
    setValue,
    formState: { isSubmitting, errors },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(featuresStepSchema),
    defaultValues: {
      features: buildDefaultFeatures(initialFeatures, comparableAreas),
    },
  });

  const {
    fields: featureFields,
    append: appendFeature,
    remove: removeFeature,
  } = useFieldArray({ control, name: "features" });

  const features = useWatch({ control, name: "features" });

  const weightSum = (features ?? []).reduce((sum, f) => sum + (Number(f?.weightPct) || 0), 0);
  const weightsBalanced = Math.abs(weightSum - 100) <= 0.1;

  const total = featureFields.length;
  const rated = (features ?? []).filter((f) => f?.rating != null).length;
  const missing = total - rated;

  // The closed pool (F-6): every preset entry not already an active row —
  // starts as the 3 "exceptional" features, refills with a removed row.
  const activeFeatureKeys = new Set((features ?? []).map((f) => f?.key));
  const availableFeatures = FEATURE_PRESETS.lokal.filter(
    (e) => !activeFeatureKeys.has(e.key as LokalFeatureKey),
  );

  const featuresError = errors.features?.root?.message ?? errors.features?.message;

  // Live KCS preview (Task 9) — mirrors the confirm-path engine call
  // (`cards.tsx`'s `KcsBreakdown` / `applyCalculationConfirm`) against the
  // CURRENT form state; never persisted, purely a render-time preview.
  // `computeKcsOnScale` throws on empty comparables / non-positive price or
  // area, and on a rating it cannot place in the described scale — any such
  // state collapses to `null`, rendered as "—" everywhere below instead of
  // crashing the step.
  const { live, uis } = useMemo(() => {
    const input: KcsInput = {
      comparables,
      area,
      features: (features ?? []).map((f) => ({
        name: f?.name ?? "",
        weight: (Number(f?.weightPct) || 0) / 100,
        rating: f?.rating ?? null,
        key: f?.key,
        definitions: f?.definitions,
      })),
    };
    let live = null;
    let uis: Array<number | null> = [];
    try {
      uis = featureUis(input);
      live = computeKcsOnScale(input);
    } catch {
      // incomplete ratings or an unusable sample — see above
    }
    return { live, uis };
  }, [comparables, area, features]);

  const sumUiPos =
    live && live.vmax > live.vmin
      ? Math.min(1, Math.max(0, (live.sumUi - live.vmin) / (live.vmax - live.vmin)))
      : null;

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    const result = await saveFeaturesAction(valuationId, values);
    if ("error" in result) {
      setSubmitError(result.error);
      return;
    }
    router.push(`/valuations/${valuationId}?step=5`);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div className="grid items-start gap-4 lg:grid-cols-[1.6fr_1fr]">
        <SectionCard
          icon={SlidersHorizontal}
          title="Cechy, oceny i wagi"
          sub={`oceniono ${rated} z ${total}`}
        >
          <div className="flex flex-col gap-3">
            <FeatureRatingList>
              {featureFields.map((field, index) => {
                const current = features?.[index];
                const key = current?.key ?? field.key;
                const rating = current?.rating ?? null;
                const definitions = current?.definitions ?? field.definitions;
                const isRated = rating != null;
                const ui = uis[index];
                // I-10 live, not on submit: a scale the save would refuse (B-09,
                // B-10) says so in the row while the appraiser is editing it.
                // B-08 is skipped — the „Wybierz ocenę” badge already says it.
                const rowIssue = featureIssues({
                  name: field.name,
                  weight: (Number(current?.weightPct) || 0) / 100,
                  rating,
                  definitions,
                }).find((issue) => issue.code !== "B-08");
                return (
                  <FeatureRatingRow
                    key={field.id}
                    featureKey={key}
                    name={field.name}
                    rated={isRated}
                    meta={
                      <>
                        {!isRated ? (
                          <Badge
                            variant="outline"
                            className="border-[var(--amber-line)] text-[var(--amber)]"
                          >
                            Wybierz ocenę
                          </Badge>
                        ) : null}
                        <Controller
                          control={control}
                          name={`features.${index}.weightPct`}
                          render={({ field: weightField, fieldState }) => (
                            <label className="flex items-center gap-1.5">
                              Waga
                              <Input
                                id={`feature-weight-${index}`}
                                type="number"
                                step="0.01"
                                min="0"
                                inputMode="decimal"
                                className="w-16 text-foreground"
                                aria-invalid={!!fieldState.error}
                                name={weightField.name}
                                onBlur={weightField.onBlur}
                                ref={weightField.ref}
                                value={toInputValue(weightField.value)}
                                onChange={(e) => weightField.onChange(e.target.value)}
                              />
                              %
                            </label>
                          )}
                        />
                        {isRated && ui != null ? (
                          <span className="num">Ui {sumUiFormatter.format(ui)}</span>
                        ) : null}
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          aria-expanded={!!editingScale[field.id]}
                          onClick={() =>
                            setEditingScale((open) => ({ ...open, [field.id]: !open[field.id] }))
                          }
                        >
                          Edytuj skalę
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          data-testid={`remove-feature-${key ?? index}`}
                          aria-label={`Usuń cechę ${field.name}`}
                          disabled={featureFields.length === 1}
                          onClick={() => removeFeature(index)}
                        >
                          Usuń
                        </Button>
                      </>
                    }
                  >
                    <FieldError errors={[errors.features?.[index]?.weightPct]} />
                    <FeatureRatingGroup
                      label={field.name}
                      levels={describedLevels({ definitions })}
                      definitions={definitions}
                      rating={rating}
                      onSelect={(level) =>
                        setValue(`features.${index}.rating`, level, {
                          shouldDirty: true,
                          shouldValidate: true,
                        })
                      }
                    />
                    {editingScale[field.id] ? (
                      <ScaleEditor
                        control={control}
                        index={index}
                        featureKey={key}
                        rating={rating}
                        onSelectedLevelCleared={() =>
                          setValue(`features.${index}.rating`, null, { shouldDirty: true })
                        }
                      />
                    ) : null}
                    {rowIssue ? (
                      <p role="alert" className="text-sm text-destructive">
                        {rowIssue.label}
                      </p>
                    ) : null}
                  </FeatureRatingRow>
                );
              })}
            </FeatureRatingList>

            {availableFeatures.length > 0 ? (
              <select
                data-testid="add-feature-select"
                aria-label="Dodaj cechę z puli"
                className="w-fit rounded-md border border-input bg-transparent px-3 py-1.5 text-sm"
                value=""
                onChange={(e) => {
                  const entry = FEATURE_PRESETS.lokal.find((x) => x.key === e.target.value);
                  if (!entry) return;
                  appendFeature({
                    key: entry.key as LokalFeatureKey,
                    name: entry.name,
                    weightPct: 0,
                    rating: null,
                    definitions: { ...entry.defaultDefinitions },
                  });
                }}
              >
                <option value="">+ Dodaj cechę z puli…</option>
                {availableFeatures.map((e) => (
                  <option key={e.key} value={e.key}>
                    {e.name}
                  </option>
                ))}
              </select>
            ) : null}

            {featuresError ? (
              <p role="alert" className="text-sm text-destructive">
                {featuresError}
              </p>
            ) : !weightsBalanced ? (
              <p className="text-sm text-amber-600 dark:text-amber-500">
                Suma wag wynosi {numberFormatter.format(weightSum)}% — powinna wynosić 100%.
              </p>
            ) : null}
          </div>
        </SectionCard>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-[128px]">
          <SectionCard icon={Scale} title="Wskaźnik korekty ΣUi">
            <p
              data-testid="sidebar-sum-ui"
              className={cn(
                "num text-[28px] font-semibold",
                live ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {live ? sumUiFormatter.format(live.sumUi) : "—"}
            </p>
            {live ? (
              <p className="text-[12.5px] text-muted-foreground">
                lokal {live.sumUi > 1 ? "lepszy" : live.sumUi < 1 ? "gorszy" : "równy"} od średniej
                rynkowej
              </p>
            ) : missing > 0 ? (
              <p className="text-[12.5px] text-muted-foreground">
                Wybierz oceny wszystkich cech (brakuje {missing}), żeby policzyć współczynnik.
              </p>
            ) : null}
            {live ? (
              <div className="mt-4 border-t border-border pt-4">
                <div className="relative h-2 overflow-hidden rounded-full bg-border">
                  <div className="absolute inset-y-0 left-0 right-0 bg-[var(--accent-100)]" />
                  {sumUiPos !== null ? (
                    <div
                      className="absolute -top-[3px] h-3.5 w-0.5 bg-primary"
                      style={{ left: `${sumUiPos * 100}%` }}
                    />
                  ) : null}
                </div>
                <p className="mt-2 flex justify-between text-[12.5px] text-muted-foreground">
                  <span className="num">{sumUiFormatter.format(live.vmin)}</span>
                  <span className="num">1,000</span>
                  <span className="num">{sumUiFormatter.format(live.vmax)}</span>
                </p>
              </div>
            ) : null}
          </SectionCard>

          <SectionCard icon={Calculator} title="Podgląd wartości (WR)">
            {missing > 0 ? (
              <p className="text-sm text-muted-foreground">Pojawi się po ocenie wszystkich cech.</p>
            ) : (
              <div className="flex flex-col gap-1.5 text-sm">
                <p className="text-muted-foreground">
                  Cśr × ΣUi = cena jedn.{" "}
                  <span className="num font-medium text-foreground">
                    {live ? `${unitPriceFormatter.format(live.unitValue)}/m²` : "—"}
                  </span>
                </p>
                <p className="text-muted-foreground">
                  × {area.toLocaleString("pl-PL")} m² ={" "}
                  <b data-testid="sidebar-wr-preview" className="num text-foreground">
                    {live ? `${wrFormatter.format(live.wr)} zł` : "—"}
                  </b>
                </p>
              </div>
            )}
          </SectionCard>
        </aside>
      </div>

      {submitError ? (
        <p role="alert" className="text-sm text-destructive">
          {submitError}
        </p>
      ) : null}

      <FootNav
        back={{ href: `/valuations/${valuationId}?step=3` }}
        mid={
          <span data-testid="footnav-kcs-mid">
            {missing > 0 ? (
              <>
                Oceniono{" "}
                <b>
                  {rated} z {total}
                </b>{" "}
                cech
              </>
            ) : live ? (
              <>
                ΣUi <b className="num">{sumUiFormatter.format(live.sumUi)}</b> · podgląd WR{" "}
                <b className="num">{wrFormatter.format(live.wr)} zł</b>
              </>
            ) : (
              "—"
            )}
          </span>
        }
      >
        <Button type="submit" disabled={isSubmitting || missing > 0} className="w-fit">
          Zatwierdź cechy i dalej
        </Button>
      </FootNav>
    </form>
  );
}
