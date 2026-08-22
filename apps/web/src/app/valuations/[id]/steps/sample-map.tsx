"use client";

import dynamic from "next/dynamic";

/**
 * Step 3 overview map. Leaflet touches `window` at import time, so the real
 * component (`sample-map-leaflet.tsx`) is client-only and loaded lazily in
 * its own chunk (≤ +50 KB gz) — `step-sample.tsx` keeps importing `SampleMap`
 * with the same props as before Slice 3b.
 */
export const SampleMap = dynamic(
  () => import("./sample-map-leaflet").then((m) => m.SampleMapLeaflet),
  {
    ssr: false,
    loading: () => (
      <figure
        aria-busy="true"
        data-testid="sample-map"
        className="aspect-square rounded-lg border bg-muted"
      />
    ),
  },
);
