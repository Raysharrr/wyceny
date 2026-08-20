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
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // Stale-response guard — same idiom as subject-form's `fetchSeq`: a late
  // response for an older query must not overwrite a newer list.
  const fetchSeq = useRef(0);
  // Set when a suggestion is picked: the resulting value change must not
  // immediately re-query and re-open the list the user just closed.
  const suppressNextFetch = useRef(false);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_ADDRESS_SUGGEST === "off") return;
    if (suppressNextFetch.current) {
      suppressNextFetch.current = false;
      return;
    }
    const query = value.trim();
    if (query.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const seq = ++fetchSeq.current;
    const timer = setTimeout(() => {
      void fetchSuggestions(query).then(({ suggestions: next }) => {
        if (seq !== fetchSeq.current) return; // stale response — a newer query owns the list
        setSuggestions(next);
        setActiveIndex(-1);
        setOpen(next.length > 0);
      });
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [value, debounceMs, fetchSuggestions]);

  const select = (suggestion: AddressSuggestion) => {
    suppressNextFetch.current = true;
    fetchSeq.current++; // invalidate any in-flight query from before the pick
    onValueChange(suggestion.label);
    setSuggestions([]);
    setOpen(false);
    setActiveIndex(-1);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
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
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined}
        ref={inputRef}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          setOpen(false);
          setActiveIndex(-1);
          onBlur();
        }}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Podpowiedzi adresu"
          className="bg-popover text-popover-foreground absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border shadow-md"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.label}
              id={`${listId}-opt-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm",
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
                <span className="text-muted-foreground text-xs">poza pokryciem MVP</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
