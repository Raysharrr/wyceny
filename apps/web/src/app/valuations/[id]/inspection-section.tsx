"use client";

import { useRef, useState, useTransition } from "react";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileInput } from "@/components/ui/file-input";
import {
  removeInspectionPhoto,
  saveInspectionNoteField,
  uploadInspectionPhoto,
} from "@/app/actions/inspection";
import { mintKwUploadToken } from "@/app/actions/mint-kw-token";
import { plural } from "@/components/wizard/plural";
import { SectionCard } from "@/components/wizard/section-card";
import { processPhoto } from "@/lib/photo-process-client";
import { photoUploadEnabled } from "@/lib/photo-upload-enabled";
import {
  INSPECTION_SECTIONS,
  MAX_INSPECTION_PHOTOS,
  totalInspectionPhotos,
  NOTE_FIELDS,
  type InspectionNotes,
  type InspectionSection as Section,
  type InspectionSnapshot,
  type NoteField,
} from "@/domain/inspection";

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? "http://localhost:8000";
// Wzorzec flagi klienckiej `NEXT_PUBLIC_*`: upload UI renders only when enabled; the
// note stays editable (no worker involved) so e2e/air-gapped keep working.
// Shared with the approval gate since M-1 — B-01 demands a building photo, and
// the demand has to disappear wherever the upload does.
const uploadEnabled = photoUploadEnabled();

const SECTION_LABELS: Record<Section, string> = {
  otoczenie: "Otoczenie i droga dojazdowa",
  budynekZewn: "Budynek z zewnątrz",
  wnetrza: "Wnętrza",
};

/**
 * Field labels mirror the operat's own headings, and the hints say which part
 * of the document the field ends up in. Both matter: until 16.09 one note fed
 * four sections at once, and the appraiser had no way to tell where a sentence
 * would surface — the building's age typed once came out in §8.1, §8.3 and
 * §8.4 (D-15, D-31).
 */
const NOTE_FIELD_LABEL: Record<NoteField, string> = {
  otoczenie: "Otoczenie",
  budynek: "Budynek",
  lokalUklad: "Lokal — układ",
  wykonczenie: "Wykończenie",
  zagospodarowanie: "Zagospodarowanie działki",
  uwagi: "Uwagi",
};

const NOTE_FIELD_HINT: Record<NoteField, string> = {
  otoczenie: "Sąsiedztwo, usługi, tereny zielone, dojazd i komunikacja. → §8.1 Położenie",
  budynek: "Stan części wspólnych: klatka, dźwig, domofon, elewacja. → §8.3 Opis budynku",
  lokalUklad: "Liczba i układ pomieszczeń, kondygnacja lokalu. → §8.3 Opis lokalu",
  wykonczenie: "Podłogi, ściany, stolarka, instalacje, stan łazienki i kuchni. → §8.3 Opis lokalu",
  zagospodarowanie: "Co jest na działce: ogrodzenie, parking, zieleń, chodniki. → §8.4",
  uwagi: "Twoje uwagi do operatu. Jedyne pole drukowane dosłownie. → §8.3 Uwagi z oględzin",
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
  const [notes, setNotes] = useState<InspectionNotes>(inspection?.notes ?? {});
  // Read-only (ADR-017 reg. 5): the pre-split note stays visible so nothing the
  // appraiser typed is lost, but it is no longer writable, no longer a prose
  // fact and no longer printed. Copying it into the six fields was considered
  // and rejected — it would put the same text back into every section.
  const legacyNote = inspection?.note?.trim() ?? "";
  const [isPending, startTransition] = useTransition();
  const inputRefs = useRef<Partial<Record<Section, HTMLInputElement | null>>>({});

  const total = totalInspectionPhotos(inspection);

  const uploadFiles = async (section: Section, files: FileList) => {
    setError(null);
    const list = Array.from(files);
    try {
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
    } catch {
      // mintKwUploadToken (a server action over the network) can reject
      // outright, and processPhoto's ok-branch parses JSON/base64 without a
      // guard — either throw must not brick the upload UI forever (final
      // review): the finally below always clears `uploading`.
      setError("Nie udało się przetworzyć zdjęcia — sprawdź połączenie i spróbuj ponownie.");
    } finally {
      setUploading(null);
      const input = inputRefs.current[section];
      if (input) input.value = "";
    }
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
      {INSPECTION_SECTIONS.map((section) => {
        const count = (inspection?.photos[section] ?? []).length;
        return (
          <SectionCard
            key={section}
            icon={Camera}
            title={SECTION_LABELS[section]}
            sub={`${count} ${plural(count, "zdjęcie", "zdjęcia", "zdjęć")}`}
          >
            <div className="flex flex-col gap-2">
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
                <FileInput
                  ref={(el) => {
                    inputRefs.current[section] = el;
                  }}
                  multiple
                  accept="image/jpeg,image/png"
                  aria-label={`Dodaj zdjęcia — ${SECTION_LABELS[section]}`}
                  label="Dodaj zdjęcia"
                  hint="JPEG lub PNG, do 10 MB każde"
                  showSelected={false}
                  disabled={uploading !== null || total >= MAX_INSPECTION_PHOTOS}
                  onChange={(e) => {
                    if (e.target.files?.length) void uploadFiles(section, e.target.files);
                  }}
                />
              ) : null}
            </div>
          </SectionCard>
        );
      })}
      {uploading ? (
        <p data-testid="inspection-progress" className="text-sm text-muted-foreground">
          ⏳ Przetwarzam zdjęcie {uploading}…
        </p>
      ) : null}
      <SectionCard title="Notatka z wizyty">
        <div className="flex flex-col gap-5">
          <p className="text-sm text-muted-foreground">
            Każde pole zasila jedną sekcję opisu w kroku 6. Pisz w nim tylko to, czego dotyczy —
            wątek wpisany nie tam trafi do niewłaściwej części operatu.
          </p>
          {NOTE_FIELDS.map((field) => (
            <div key={field} className="flex flex-col gap-2">
              <label htmlFor={`note-${field}`} className="text-sm font-medium">
                {NOTE_FIELD_LABEL[field]}
              </label>
              <p className="text-xs text-muted-foreground">{NOTE_FIELD_HINT[field]}</p>
              <textarea
                id={`note-${field}`}
                className="min-h-24 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base md:text-sm"
                value={notes[field] ?? ""}
                onChange={(e) => setNotes((prev) => ({ ...prev, [field]: e.target.value }))}
              />
              <Button
                type="button"
                variant="outline"
                className="self-start"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    const r = await saveInspectionNoteField(valuationId, field, notes[field] ?? "");
                    if (r?.error) setError(r.error);
                  })
                }
              >
                Zapisz: {NOTE_FIELD_LABEL[field]}
              </Button>
            </div>
          ))}
          {legacyNote ? (
            <div className="flex flex-col gap-2 rounded-lg border border-dashed border-input p-3">
              <p className="text-sm font-medium">Dawna notatka — rozdziel na pola</p>
              <p className="text-xs text-muted-foreground">
                Notatka sprzed podziału na pola. Nie trafia już do operatu ani do opisów — przenieś
                z niej treść do właściwych pól powyżej.
              </p>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{legacyNote}</p>
            </div>
          ) : null}
        </div>
      </SectionCard>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
