"use client";

import { createContext, useContext, useMemo, useState } from "react";

type PreviewMapsState = {
  /**
   * The preview currently on screen was rendered WITHOUT the §8.1 maps,
   * because the appraiser asked for it after Geoportal refused.
   */
  previewWithoutMaps: boolean;
  setPreviewWithoutMaps: (value: boolean) => void;
};

/**
 * Outside the provider nothing has been read, so nothing has been decided —
 * `ValuationActions` also mounts on the flat view, where there is no reader
 * at all and issuing is not on offer either.
 */
const NO_READER: PreviewMapsState = {
  previewWithoutMaps: false,
  setPreviewWithoutMaps: () => {},
};

const PreviewMapsContext = createContext<PreviewMapsState>(NO_READER);

/**
 * Carries ONE fact across step 7: whether the document the appraiser is
 * looking at has the §8.1 maps in it.
 *
 * It exists because the „bez map" path moved off the issue button and onto
 * the reader (Task 12, spec §C), and the two live in different components
 * with server-rendered cards between them. Without this the issue would make
 * its own decision about maps, and the appraiser who read a mapless preview
 * because Geoportal was down would either get maps they never saw, or — once
 * the issue's own way of dropping them is gone — a refusal with no
 * way forward.
 *
 * CLIENT state on purpose. The decision belongs to the screen being read and
 * expires with it: reload, and the preview re-renders and asks Geoportal
 * again. Persisting it would have meant a sentinel in the freeze marker
 * (whose documented meaning is "these bytes were fetched for this address"),
 * and inferring it from the preview blob would have meant reading consent out
 * of a display cache. What gets signed has to be consented to explicitly.
 *
 * Not a security boundary: `skipMaps` has always been a client-supplied
 * choice, it can only make the issued document poorer rather than richer, and
 * it is audited on the approved row either way (`mapsSkipped`).
 */
export function PreviewMapsProvider({ children }: { children: React.ReactNode }) {
  const [previewWithoutMaps, setPreviewWithoutMaps] = useState(false);
  const value = useMemo(
    () => ({ previewWithoutMaps, setPreviewWithoutMaps }),
    [previewWithoutMaps],
  );
  return <PreviewMapsContext.Provider value={value}>{children}</PreviewMapsContext.Provider>;
}

export const usePreviewMaps = () => useContext(PreviewMapsContext);
