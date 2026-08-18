"use client";

import { useEffect, useRef, useState } from "react";
import { FileSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/wizard/section-card";
import { previewOperat, type PreviewOperatResult } from "@/app/actions/preview-operat";

/**
 * Reader chrome, chosen by measurement rather than taste (spec §C). The
 * toolbar and the page-thumbnail sidebar together eat enough of the column
 * that the same operat renders at 46% zoom with them and 100% without, and
 * the embedded viewer still scrolls perfectly well once they are gone.
 */
const READER_CHROME = "#toolbar=0&navpanes=0";

/**
 * Step 7's preview — Client Component, because the render is a round trip the
 * appraiser watches happen, and because `#toolbar=0` on a stable blob key only
 * works if the URL the action returned is embedded verbatim.
 *
 * It takes PRIMITIVES, never the `Valuation`. Two reasons, both load-bearing:
 * the step's blocker computation reaches `domain/prose-hash`, which imports
 * `node:crypto` and must not cross into the browser bundle; and `inputs`
 * carries the whole comparable sample, which this screen has no use for.
 *
 * Three states, one component (spec §C):
 *  - **braki** — nothing renders by itself. The appraiser asks, explicitly,
 *    with "Pokaż podgląd mimo braków"; issuing stays refused by the gate,
 *    which lives in the card above and is none of this component's business
 *    (F-4: nothing here approves anything).
 *  - **gotowe** — the render starts on mount, because a document the
 *    appraiser has to ask to see is a document they will sign unseen.
 *  - **wydany** — not reachable from the wizard: `page.tsx` routes anything
 *    that is no longer a draft to the flat view, which embeds `docUrl`. That
 *    is deliberate rather than incidental — `/api/podglad/[id]` answers 404
 *    once the operat is issued, so pointing an issued operat at the preview
 *    would show the appraiser an error where the document should be.
 */
export function OperatPreview({
  valuationId,
  hasBlockers,
}: {
  valuationId: string;
  hasBlockers: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  // The mount render starts immediately, so the card must not flash empty
  // before the first effect runs.
  const [pending, setPending] = useState(!hasBlockers);
  const [error, setError] = useState<string | null>(null);
  const [mapsUnavailable, setMapsUnavailable] = useState(false);
  /** "I already started one." Survives StrictMode's double-invoked mount. */
  const autoStarted = useRef(false);
  const mounted = useRef(true);

  const build = async (opts?: { skipMaps?: boolean }) => {
    setError(null);
    setMapsUnavailable(false);
    // The previous render goes NOW, not when the new one lands. Everything on
    // this screen is supposed to describe the draft as it stands; a document
    // left up while its replacement is being composed — or, worse, above the
    // red message saying the replacement failed — is the one thing this step
    // must never show.
    setUrl(null);
    setPending(true);
    let result: PreviewOperatResult;
    try {
      result = await previewOperat(valuationId, opts);
    } catch (callError) {
      // The action never reached the server. Without this the card would sit
      // in "Składanie podglądu…" forever on an unhandled rejection.
      console.error("previewOperat call failed", callError);
      if (mounted.current) {
        setPending(false);
        setError("Nie udało się połączyć z serwerem — sprawdź połączenie i spróbuj ponownie.");
      }
      return;
    }
    // The render takes seconds and the appraiser may have stepped away.
    if (!mounted.current) return;
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      setMapsUnavailable(result.mapsUnavailable === true);
      return;
    }
    // Verbatim. The blob key is stable and every render overwrites it in
    // place, so the `?v=` the action derived from the bytes is the only thing
    // standing between the appraiser and the render they just replaced —
    // rebuilding this URL from `valuationId` would quietly re-serve the old one.
    setUrl(result.url);
  };

  useEffect(() => {
    mounted.current = true;
    if (!autoStarted.current && !hasBlockers) {
      autoStarted.current = true;
      void build();
    }
    return () => {
      mounted.current = false;
    };
    // Mount only: this is a side effect with a worker round trip behind it,
    // and the ref above — not the dependency list — is what keeps it to one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SectionCard
      icon={FileSearch}
      title="Podgląd operatu"
      sub="dokument, za który bierzesz odpowiedzialność"
    >
      <div className="flex flex-col gap-3">
        {hasBlockers ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              Operat ma braki. Podgląd pokaże dokument w takim stanie, w jakim jest teraz — wydanie
              pozostaje niedostępne, dopóki braki nie zostaną uzupełnione.
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-fit"
              data-testid="preview-despite-blockers"
              disabled={pending}
              onClick={() => void build()}
            >
              {pending ? "Składanie podglądu…" : "Pokaż podgląd mimo braków"}
            </Button>
          </div>
        ) : pending ? (
          <p data-testid="preview-pending" className="text-sm text-muted-foreground">
            Składanie podglądu…
          </p>
        ) : null}

        {error ? (
          <div className="flex flex-col gap-2" data-testid="preview-error">
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => void build()}
              >
                Spróbuj ponownie
              </Button>
              {/* The "bez map" path moved here from issuing (spec §C) — and it
                  is a click, never a fallback: `skipMaps` lifts the map freeze
                  and deletes the frozen bytes, so an automatic retry with it
                  would throw away maps the appraiser never chose to drop. The
                  label says podgląd, not zatwierdź: this screen issues nothing. */}
              {mapsUnavailable ? (
                <Button
                  type="button"
                  variant="outline"
                  data-testid="preview-skip-maps"
                  disabled={pending}
                  onClick={() => void build({ skipMaps: true })}
                >
                  Pokaż podgląd bez map
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {url ? (
          <iframe
            title="Podgląd operatu (PDF)"
            src={url + READER_CHROME}
            className="h-[85vh] w-full rounded-md border"
          />
        ) : null}
      </div>
    </SectionCard>
  );
}
