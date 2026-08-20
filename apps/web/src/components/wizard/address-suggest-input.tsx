"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Ref } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AddressSuggestion } from "@/ports/address-suggest";

const MIN_QUERY_LENGTH = 3;

type AddressSuggestInputProps = {
  id: string;
  name: string;
  value: string;
  placeholder?: string;
  onValueChange: (value: string) => void;
  onBlur: () => void;
  /** Injected server action — keeps this component free of app-layer imports. */
  fetchSuggestions: (query: string) => Promise<{ suggestions: AddressSuggestion[] }>;
  inputRef?: Ref<HTMLInputElement>;
  /** Test hook only — production mounts keep the 300 ms default. */
  debounceMs?: number;
};

/**
 * The step-1 address input with UUG street suggestions — a hand-rolled ARIA
 * combobox over the existing shadcn `<Input>`. Hand-rolled on purpose: the
 * repo has no cmdk/Popover component and a listbox is smaller than a new
 * dependency (spec: 2026-08-20-podpowiedzi-adresu-design.md).
 *
 * Suggestions are an enhancement: every failure path (action returns [],
 * env kill-switch, slow response) leaves a plain working input. Free typing
 * stays allowed — selection just inserts the canonical "Miasto, Ulica".
 */
export function AddressSuggestInput({
  id,
  name,
  value,
  placeholder,
  onValueChange,
  onBlur,
  fetchSuggestions,
  inputRef,
  debounceMs = 300,
}: AddressSuggestInputProps) {
  const listId = useId();
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  // The query the current `suggestions` answer. The list is DERIVED visible
  // only while the input still matches it — no synchronous state resets in
  // the effect (lint: cascading renders), and a stale list can never flash
  // for a query it does not belong to.
  const [queryFor, setQueryFor] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // Stale-response guard — same idiom as subject-form's `fetchSeq`: a late
  // response for an older query must not overwrite a newer list. Blur bumps
  // it too, so a response landing after the user left the field can never
  // open a "ghost" list over it (review I-1).
  const fetchSeq = useRef(0);
  // Set when a suggestion is picked: the resulting value change must not
  // immediately re-query and re-open the list the user just closed.
  const suppressNextFetch = useRef(false);
  // The parent recreates `fetchSuggestions` on every render (inline closure in
  // subject-form.tsx). Kept in a ref so the debounce effect depends only on
  // `value` — otherwise unrelated parent re-renders restart the debounce and
  // resurrect the list after blur/selection (review I-3).
  const fetchRef = useRef(fetchSuggestions);
  useEffect(() => {
    fetchRef.current = fetchSuggestions;
  }, [fetchSuggestions]);
  // Fetches are scheduled only while the field is focused — a mount with a
  // prefilled address (edit mode) or a programmatic value change must not
  // pop the list unprompted.
  const focusRef = useRef(false);

  const trimmed = value.trim();
  const visible =
    open && trimmed.length >= MIN_QUERY_LENGTH && queryFor === trimmed && suggestions.length > 0;

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_ADDRESS_SUGGEST === "off") return;
    if (!focusRef.current) return;
    if (suppressNextFetch.current) {
      suppressNextFetch.current = false;
      return;
    }
    const query = value.trim();
    if (query.length < MIN_QUERY_LENGTH) return;
    const seq = ++fetchSeq.current;
    const timer = setTimeout(() => {
      // Blur (or a newer query) between scheduling and firing: skip the
      // request entirely — no pointless call to the geocoder for a field
      // the user already left.
      if (seq !== fetchSeq.current || !focusRef.current) return;
      void fetchRef
        .current(query)
        .then(({ suggestions: next }) => {
          if (seq !== fetchSeq.current) return; // stale — a newer query or a blur owns the list
          if (!focusRef.current) return;
          setSuggestions(next);
          setQueryFor(query);
          setActiveIndex(-1);
          setOpen(next.length > 0);
        })
        // The action and adapter are total, but the Server Action TRANSPORT
        // is not (offline, client/server skew after a deploy) — a rejection
        // must degrade to "no suggestions", never to an unhandled error.
        .catch(() => {});
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [value, debounceMs]);

  const select = (suggestion: AddressSuggestion) => {
    suppressNextFetch.current = true;
    fetchSeq.current++; // invalidate any in-flight query from before the pick
    onValueChange(suggestion.label);
    setOpen(false);
    setActiveIndex(-1);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!visible) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (event.key === "Enter") {
      if (activeIndex >= 0 && activeIndex < suggestions.length) {
        event.preventDefault();
        select(suggestions[activeIndex]);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={visible}
        aria-controls={visible ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={
          visible && activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined
        }
        ref={inputRef}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => {
          focusRef.current = true;
        }}
        onBlur={() => {
          focusRef.current = false;
          fetchSeq.current++; // cancel the pending debounce and any in-flight response
          setOpen(false);
          setActiveIndex(-1);
          onBlur();
        }}
      />
      {visible ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Podpowiedzi adresu"
          className="bg-popover text-popover-foreground absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border shadow-md"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={`${suggestion.teryt ?? ""}-${suggestion.label}`}
              id={`${listId}-opt-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={cn(
                "flex cursor-pointer flex-col gap-0.5 px-3 py-2 text-sm",
                index === activeIndex && "bg-accent text-accent-foreground",
              )}
              // preventDefault keeps focus in the input, so the field's blur
              // (which triggers the subject autofetch) does not fire mid-pick.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => select(suggestion)}
            >
              <span>{suggestion.label}</span>
              {suggestion.inCoverage ? null : (
                <span className="text-muted-foreground text-xs">
                  Adres spoza Poznania — dane przedmiotu i mapy trzeba będzie wpisać ręcznie
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
