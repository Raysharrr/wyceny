"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  removeInspectionPhoto,
  saveInspectionNote,
  uploadInspectionPhoto,
} from "@/app/actions/inspection";
import { mintKwUploadToken } from "@/app/actions/mint-kw-token";
import { processPhoto } from "@/lib/photo-process-client";
import {
  INSPECTION_SECTIONS,
  MAX_INSPECTION_PHOTOS,
  totalInspectionPhotos,
  type InspectionSection as Section,
  type InspectionSnapshot,
} from "@/domain/inspection";

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? "http://localhost:8000";
// Mirrors NEXT_PUBLIC_KW_UPLOAD: upload UI renders only when enabled; the
// note stays editable (no worker involved) so e2e/air-gapped keep working.
const uploadEnabled = process.env.NEXT_PUBLIC_PHOTO_UPLOAD !== "off";

const SECTION_LABELS: Record<Section, string> = {
  otoczenie: "Otoczenie i droga dojazdowa",
  budynekZewn: "Budynek z zewnątrz",
  wnetrza: "Wnętrza",
};

export function InspectionSection({
  valuationId,
  inspection,
}: {
  valuationId: string;
  inspection: InspectionSnapshot | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null); // "2/5" progress
  const [note, setNote] = useState(inspection?.note ?? "");
  const [isPending, startTransition] = useTransition();
  const inputRefs = useRef<Partial<Record<Section, HTMLInputElement | null>>>({});

  const total = totalInspectionPhotos(inspection);

  const uploadFiles = async (section: Section, files: FileList) => {
    setError(null);
    const list = Array.from(files);
    for (let i = 0; i < list.length; i++) {
      setUploading(`${i + 1}/${list.length}`);
      const minted = await mintKwUploadToken();
      if ("error" in minted) {
        setError(minted.error);
        break;
      }
      const processed = await processPhoto({
        file: list[i],
        token: minted.token,
        workerUrl: WORKER_URL,
      });
      if (processed.kind !== "ok") {
        setError(processed.message);
        break;
      }
      const form = new FormData();
      form.set("photo", processed.blob);
      const result = await uploadInspectionPhoto(valuationId, section, form);
      if ("error" in result) {
        setError(result.error);
        break;
      }
    }
    setUploading(null);
    const input = inputRefs.current[section];
    if (input) input.value = "";
  };

  return (
    <section data-testid="inspection-section" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Oględziny</h2>
        <span data-testid="inspection-counter" className="text-sm text-muted-foreground">
          {total}/{MAX_INSPECTION_PHOTOS}
        </span>
      </div>
      {total === 0 ? (
        <p data-testid="inspection-hint" className="text-sm text-amber-600">
          ⚠ Operat bez dokumentacji fotograficznej — dodaj zdjęcia z oględzin.
        </p>
      ) : null}
      {INSPECTION_SECTIONS.map((section) => (
        <div key={section} className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{SECTION_LABELS[section]}</h3>
          <div className="flex flex-wrap gap-2">
            {(inspection?.photos[section] ?? []).map((key) => (
              <figure key={key} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- bytea-served thumbnail, not an optimizable asset */}
                <img
                  src={`/api/docs/${encodeURIComponent(key)}`}
                  alt={`Zdjęcie — ${SECTION_LABELS[section]}`}
                  className="h-24 w-32 rounded-md border object-cover"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Usuń zdjęcie"
                  disabled={isPending}
                  onClick={() =>
                    startTransition(async () => {
                      const r = await removeInspectionPhoto(valuationId, section, key);
                      if (r?.error) setError(r.error);
                    })
                  }
                >
                  Usuń
                </Button>
              </figure>
            ))}
          </div>
          {uploadEnabled ? (
            <input
              ref={(el) => {
                inputRefs.current[section] = el;
              }}
              type="file"
              multiple
              accept="image/jpeg,image/png"
              aria-label={`Dodaj zdjęcia — ${SECTION_LABELS[section]}`}
              disabled={uploading !== null || total >= MAX_INSPECTION_PHOTOS}
              onChange={(e) => {
                if (e.target.files?.length) void uploadFiles(section, e.target.files);
              }}
            />
          ) : null}
        </div>
      ))}
      {uploading ? (
        <p data-testid="inspection-progress" className="text-sm text-muted-foreground">
          ⏳ Przetwarzam zdjęcie {uploading}…
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <label htmlFor="inspection-note" className="text-sm font-medium">
          Notatka z oględzin
        </label>
        <textarea
          id="inspection-note"
          className="min-h-24 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base md:text-sm"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const r = await saveInspectionNote(valuationId, note);
              if (r?.error) setError(r.error);
            })
          }
        >
          Zapisz notatkę
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
