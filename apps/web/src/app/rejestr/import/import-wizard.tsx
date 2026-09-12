"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, Check, ChevronRight, Upload } from "lucide-react";
import {
  finalizeCoopImportAction,
  getCoopMapping,
  importCoopChunkAction,
  readCoopSheet,
  startCoopImportAction,
} from "@/app/actions/coop-import";
import { Button } from "@/components/ui/button";
import { FileInput } from "@/components/ui/file-input";
import { Input } from "@/components/ui/input";
import {
  COOP_FIELDS,
  missingRequiredFields,
  parseCoopSheet,
  type CoopFieldKey,
  type ColumnMapping,
} from "@/domain/coop-import";
import {
  IMPORT_CHUNK,
  sumCoopChunks,
  type CoopChunkResult,
  type CoopImportSummary,
} from "@/lib/coop-import-service";
import { plural } from "@/lib/coop-format";
import { PRICE_KINDS, type NewCoopTransaction, type PriceKind } from "@/ports/coop-registry";
import type { CoopSheet } from "@/ports/coop-sheet";

const NEW_COOP = "__new__";
const ABSENT = "absent";
const UNMAPPED = "";

/** Labels verbatim from makieta RejestrImport (HANDOFF §1: not proposals — decisions). */
const FIELD_LABEL: Record<CoopFieldKey, string> = {
  address: "Adres (ulica / osiedle)",
  buildingNumber: "Nr budynku",
  flatNumber: "Nr mieszkania",
  area: "Powierzchnia [m²]",
  priceTotal: "Cena [zł]",
  date: "Data transakcji",
  rightType: "Rodzaj prawa",
  rep: "Rep. aktu",
  floor: "Piętro",
  rooms: "Pokoje",
  buildYear: "Rok budowy",
};
const PRICE_KIND_LABEL: Record<PriceKind, string> = {
  transakcyjna: "transakcyjna",
  ofertowa: "ofertowa",
  nieustalona: "nieustalona",
};
const SELECT =
  "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const REQ = <span className="text-[#e7000b]"> *</span>;

/** What goes back to the server: the facts only — pos/source/dedupeKey are assigned there. */
const toWire = (r: NewCoopTransaction) => ({
  cooperative: r.cooperative,
  address: r.address,
  buildingNumber: r.buildingNumber,
  flatNumber: r.flatNumber,
  area: r.area,
  priceTotal: r.priceTotal,
  date: r.date,
  priceKind: r.priceKind,
  rightType: r.rightType,
  rep: r.rep,
  floor: r.floor,
  rooms: r.rooms,
  buildYear: r.buildYear,
});

const colName = (sheet: CoopSheet, headerRow: number | null, i: number): string =>
  (headerRow !== null && sheet.rows[headerRow]?.[i]?.trim()) || `Kolumna ${i + 1}`;

type Phase =
  | { kind: "idle" }
  | { kind: "running"; done: number; total: number }
  | { kind: "done"; summary: CoopImportSummary }
  | { kind: "failed"; message: string; done: number; total: number };

export function ImportWizard({ cooperatives }: { cooperatives: string[] }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Step 1
  const [file, setFile] = useState<{ name: string; sheets: CoopSheet[] } | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [headerRow, setHeaderRow] = useState<number | null>(0);
  const [coopChoice, setCoopChoice] = useState(cooperatives[0] ?? NEW_COOP);
  const [coopNew, setCoopNew] = useState("");
  const [city, setCity] = useState("Poznań");
  const [priceKind, setPriceKind] = useState<PriceKind>("nieustalona");
  const cooperative = (coopChoice === NEW_COOP ? coopNew : coopChoice).trim();

  // Step 2
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const sheet = file?.sheets[sheetIdx] ?? null;
  const preview = useMemo(
    () => (sheet ? sheet.rows.slice(headerRow === null ? 0 : headerRow + 1).slice(0, 3) : []),
    [sheet, headerRow],
  );
  const missing = missingRequiredFields(mapping);

  // Step 3
  const parsed = useMemo(
    () =>
      sheet && step === 3
        ? parseCoopSheet(sheet.rows, mapping, { cooperative, priceKind, headerRow })
        : null,
    [sheet, step, mapping, cooperative, priceKind, headerRow],
  );
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [shown, setShown] = useState<"none" | "skipped" | "no_flat" | "fix">("none");

  const onFile = (f: File | null) => {
    if (!f) return;
    setError(null);
    const fd = new FormData();
    fd.set("file", f);
    start(async () => {
      const r = await readCoopSheet(fd);
      if (r.error !== undefined) return setError(r.error);
      setFile({ name: f.name, sheets: r.sheets });
      setSheetIdx(0);
      setHeaderRow(0);
      setMapping({});
    });
  };

  const goMapping = () =>
    start(async () => {
      const remembered = await getCoopMapping(cooperative);
      if (remembered && sheet) {
        const ok = Object.values(remembered).every((v) => typeof v !== "number" || v < sheet.cols);
        setMapping(ok ? remembered : {});
      }
      setStep(2);
    });

  const runImport = () => {
    if (!parsed || !file) return;
    const total = parsed.rows.length;
    const base = {
      cooperative,
      fileName: file.name,
      mapping,
      skipped: parsed.skipped,
      warnings: parsed.warnings,
    };
    setPhase({ kind: "running", done: 0, total });
    start(async () => {
      const started = await startCoopImportAction(base);
      if (!("batchId" in started))
        return setPhase({ kind: "failed", message: started.error, done: 0, total });
      const batchId = started.batchId;
      const chunks: CoopChunkResult[] = [];
      for (let i = 0; i < total; i += IMPORT_CHUNK) {
        const r = await importCoopChunkAction({
          batchId,
          city,
          rows: parsed.rows.slice(i, i + IMPORT_CHUNK).map(toWire),
        });
        if (r.error !== undefined)
          return setPhase({ kind: "failed", message: r.error, done: i, total });
        chunks.push(r);
        setPhase({ kind: "running", done: Math.min(i + IMPORT_CHUNK, total), total });
      }
      const fin = await finalizeCoopImportAction({
        ...base,
        batchId,
        rowsTotal: sheet?.rows.length ?? total,
        totals: sumCoopChunks(chunks),
      });
      if (fin.error !== undefined)
        return setPhase({ kind: "failed", message: fin.error, done: total, total });
      setPhase({ kind: "done", summary: fin });
    });
  };

  const count = (xs: readonly { reason: string }[], ...reasons: string[]) =>
    xs.filter((x) => reasons.includes(x.reason)).length;

  return (
    <div className="flex flex-col gap-5">
      <Stepper step={step} />

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      {step === 1 ? (
        <Card
          title="Plik źródłowy"
          sub={
            file && sheet
              ? `wczytano ${sheet.rows.length} ${plural(sheet.rows.length, "wiersz", "wiersze", "wierszy")}, ${sheet.cols} ${plural(sheet.cols, "kolumnę", "kolumny", "kolumn")}`
              : "XLS lub XLSX ze spółdzielni"
          }
        >
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-4">
              <FileInput
                name="file"
                accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                label={file ? "Zmień plik" : "Wybierz plik"}
                aria-label="Plik XLS"
                disabled={pending}
                showSelected={false}
                hint={file ? file.name : "XLS lub XLSX, do 12 MB"}
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              />
              {pending && !file ? (
                <span className="text-sm text-muted-foreground">Wczytywanie…</span>
              ) : null}
            </div>
            {file && sheet ? (
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm font-medium">
                  Arkusz
                  <select
                    className={SELECT}
                    value={sheetIdx}
                    onChange={(e) => {
                      setSheetIdx(Number(e.target.value));
                      setMapping({});
                    }}
                  >
                    {file.sheets.map((s, i) => (
                      <option key={s.name} value={i}>
                        {s.name} ({s.rows.length}{" "}
                        {plural(s.rows.length, "wiersz", "wiersze", "wierszy")})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium">
                  Wiersz nagłówka
                  <select
                    className={SELECT}
                    value={headerRow === null ? "none" : headerRow}
                    onChange={(e) =>
                      setHeaderRow(e.target.value === "none" ? null : Number(e.target.value))
                    }
                  >
                    {sheet.rows.slice(0, 10).map((r, i) => (
                      <option key={i} value={i}>
                        wiersz {i + 1}:{" "}
                        {r.filter(Boolean).slice(0, 4).join(" · ").slice(0, 60) || "(pusty)"}
                      </option>
                    ))}
                    <option value="none">arkusz nie ma nagłówka — dane od wiersza 1</option>
                  </select>
                </label>
              </div>
            ) : null}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-1 text-sm font-medium">
                <span>Spółdzielnia{REQ}</span>
                <select
                  className={SELECT}
                  value={coopChoice}
                  onChange={(e) => setCoopChoice(e.target.value)}
                >
                  {cooperatives.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  <option value={NEW_COOP}>+ nowa spółdzielnia…</option>
                </select>
                {coopChoice === NEW_COOP ? (
                  <Input
                    value={coopNew}
                    onChange={(e) => setCoopNew(e.target.value)}
                    placeholder="np. SM „Osiedle Młodych”"
                    aria-label="Nazwa nowej spółdzielni"
                  />
                ) : null}
                <p className="text-xs font-normal text-muted-foreground">
                  Jedna wartość dla całego pliku — plik ze spółdzielni nie ma kolumny z jej własną
                  nazwą. Wpisze się w każdy zaimportowany wiersz.
                </p>
              </div>
              <label className="flex flex-col gap-1 text-sm font-medium">
                <span>Miasto{REQ}</span>
                <Input value={city} onChange={(e) => setCity(e.target.value)} />
                <span className="text-xs font-normal text-muted-foreground">
                  Miasto, w którym leżą lokale z tego pliku — rejestry go nie zawierają, a bez niego
                  nie ustalimy lokalizacji.
                </span>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                <span>Rodzaj ceny{REQ}</span>
                <select
                  className={SELECT}
                  value={priceKind}
                  onChange={(e) => setPriceKind(e.target.value as PriceKind)}
                >
                  {PRICE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {PRICE_KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
                <span className="text-xs font-normal text-muted-foreground">
                  Rejestry spółdzielni nie zawsze rozróżniają cenę ofertową od transakcyjnej — jeśli
                  nie wiesz, zostaw «nieustalona».
                </span>
              </label>
            </div>
            <div className="flex justify-end">
              <Button
                onClick={goMapping}
                disabled={pending || !sheet || !cooperative || !city.trim()}
              >
                Dalej: mapowanie kolumn
                <ChevronRight data-icon="inline-end" />
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {step === 2 && sheet ? (
        <Card title="Mapowanie kolumn" sub="pola oznaczone * są wymagane">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4 font-medium">Pole aplikacji</th>
                  <th className="py-2 pr-4 font-medium">Kolumna z pliku</th>
                  <th className="py-2 pr-4 font-medium">Podgląd — wiersz 1</th>
                  <th className="py-2 pr-4 font-medium">wiersz 2</th>
                  <th className="py-2 pr-4 font-medium">wiersz 3</th>
                </tr>
              </thead>
              <tbody>
                {COOP_FIELDS.map((f) => {
                  const v = mapping[f.key];
                  const value =
                    v === ABSENT ? ABSENT : typeof v === "number" ? String(v) : UNMAPPED;
                  const unmapped = value === UNMAPPED;
                  const note =
                    f.key === "rightType" && unmapped
                      ? {
                          text: "Bez tej kolumny każdy wiersz dostanie w kroku 3 odznakę „prawo nieznane”.",
                          warn: true,
                        }
                      : (f.key === "floor" || f.key === "rooms" || f.key === "buildYear") &&
                          unmapped
                        ? {
                            text: "Brak w pliku — wiersze dostaną odznakę „atrybuty nieznane”.",
                            warn: false,
                          }
                        : f.key === "flatNumber" && value === ABSENT
                          ? {
                              text: "Wiersze bez numeru mieszkania zaimportujemy; rozpoznajemy je wtedy po powierzchni, a w podsumowaniu zobaczysz ich listę.",
                              warn: true,
                            }
                          : null;
                  return (
                    <tr key={f.key} className={note?.warn ? "bg-[#fbf2dd]" : ""}>
                      <td className="py-2 pr-4 font-medium">
                        {FIELD_LABEL[f.key]}
                        {f.required ? (
                          REQ
                        ) : (
                          <span className="text-xs font-normal text-muted-foreground">
                            {" "}
                            (opcjonalne)
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        <select
                          className={SELECT}
                          aria-label={FIELD_LABEL[f.key]}
                          value={value}
                          onChange={(e) => {
                            const nv = e.target.value;
                            setMapping((m) => ({
                              ...m,
                              [f.key]: nv === UNMAPPED ? null : nv === ABSENT ? ABSENT : Number(nv),
                            }));
                          }}
                        >
                          <option value={UNMAPPED}>— nie mapuj —</option>
                          {f.key === "flatNumber" ? (
                            <option value={ABSENT}>— rejestr nie ma tej kolumny —</option>
                          ) : null}
                          {Array.from({ length: sheet.cols }, (_, i) => (
                            <option key={i} value={i}>
                              {colName(sheet, headerRow, i)}
                            </option>
                          ))}
                        </select>
                      </td>
                      {note ? (
                        <td
                          colSpan={3}
                          className={`py-2 pr-4 text-xs ${note.warn ? "text-[#b07a16]" : "text-muted-foreground"}`}
                        >
                          {note.text}
                        </td>
                      ) : (
                        [0, 1, 2].map((i) => (
                          <td key={i} className="py-2 pr-4 font-mono text-xs text-muted-foreground">
                            {typeof v === "number" ? (preview[i]?.[v] ?? "") : ""}
                          </td>
                        ))
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {missing.length ? (
            <p className="mt-3 text-sm text-[#b07a16]">
              Zmapuj pola wymagane: {missing.map((k) => FIELD_LABEL[k]).join(", ")}.
            </p>
          ) : null}
          <div className="mt-4 flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>
              ← Wstecz
            </Button>
            <Button
              onClick={() => {
                setPhase({ kind: "idle" });
                setShown("none");
                setStep(3);
              }}
              disabled={missing.length > 0}
            >
              Dalej: podsumowanie
              <ChevronRight data-icon="inline-end" />
            </Button>
          </div>
        </Card>
      ) : null}

      {step === 3 && parsed ? (
        <Card title="Podsumowanie" sub={`plik ${file?.name}, SM „${cooperative}”`}>
          {(() => {
            const n = parsed.rows.length;
            const d = count(parsed.skipped, "duplicate");
            const s = count(parsed.skipped, "summary");
            const bad = count(parsed.skipped, "bad_number", "bad_date");
            const w = count(parsed.warnings, "no_flat");
            const m = count(parsed.warnings, "no_flat_merge");
            const done = phase.kind === "done" ? phase.summary : null;
            const g = done?.needsFix ?? null;
            const rowsOf = (
              pred: (r: { reason: string }) => boolean,
              xs: readonly { row: number; reason: string }[],
            ) => xs.filter(pred).map((x) => x.row + 1);
            return (
              <div className="flex flex-col gap-4">
                <div className="rounded-lg border border-[#ecd9a6] bg-[#fbf2dd] p-4 text-sm text-[#b07a16]">
                  <p className="flex items-start gap-2 font-semibold">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <span>
                      {n} {plural(n, "wiersz", "wiersze", "wierszy")}, {d}{" "}
                      {plural(d, "duplikat", "duplikaty", "duplikatów")} pominięto, {s}{" "}
                      {plural(s, "wiersz", "wiersze", "wierszy")} sum/średnich pominięto
                      {bad
                        ? `, ${bad} ${plural(bad, "wiersz", "wiersze", "wierszy")} z nieczytelną liczbą lub datą pominięto`
                        : ""}
                      {g !== null
                        ? `, ${g} ${plural(g, "adres", "adresy", "adresów")} bez lokalizacji — do poprawki.`
                        : "."}
                    </span>
                  </p>
                  {g !== null ? (
                    <p className="mt-2 pl-6">
                      Wiersze bez lokalizacji zaimportowaliśmy, ale nie wejdą do doboru po
                      promieniu, dopóki nie poprawisz adresu.{" "}
                      <Link href="/rejestr?lokalizacja=do-poprawki&okres=all" className="underline">
                        Pokaż {g} {plural(g, "wiersz", "wiersze", "wierszy")}
                      </Link>
                    </p>
                  ) : (
                    <p className="mt-2 pl-6">
                      Wiersze bez lokalizacji zaimportujemy, ale nie wejdą do doboru po promieniu,
                      dopóki nie poprawisz adresu. Lokalizację ustalimy w trakcie importu.
                    </p>
                  )}
                  {parsed.skipped.length ? (
                    <p className="mt-2 pl-6">
                      <button
                        type="button"
                        className="underline"
                        onClick={() => setShown(shown === "skipped" ? "none" : "skipped")}
                      >
                        Pokaż {parsed.skipped.length}{" "}
                        {plural(
                          parsed.skipped.length,
                          "pominięty wiersz",
                          "pominięte wiersze",
                          "pominiętych wierszy",
                        )}
                      </button>
                      {shown === "skipped" ? (
                        <span className="mt-1 block font-mono text-xs">
                          duplikaty:{" "}
                          {rowsOf((r) => r.reason === "duplicate", parsed.skipped).join(", ") ||
                            "—"}{" "}
                          · sumy/średnie:{" "}
                          {rowsOf((r) => r.reason === "summary", parsed.skipped).join(", ") || "—"}{" "}
                          · nieczytelne:{" "}
                          {rowsOf(
                            (r) => r.reason === "bad_number" || r.reason === "bad_date",
                            parsed.skipped,
                          ).join(", ") || "—"}{" "}
                          · puste:{" "}
                          {rowsOf((r) => r.reason === "empty", parsed.skipped).join(", ") || "—"}
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                  {w ? (
                    <p className="mt-2 pl-6">
                      {w} {plural(w, "wiersz", "wiersze", "wierszy")} bez numeru mieszkania —
                      rozpoznane po powierzchni.{" "}
                      <button
                        type="button"
                        className="underline"
                        onClick={() => setShown(shown === "no_flat" ? "none" : "no_flat")}
                      >
                        Pokaż {w} {plural(w, "wiersz", "wiersze", "wierszy")}
                      </button>
                      {shown === "no_flat" ? (
                        <span className="mt-1 block font-mono text-xs">
                          wiersze:{" "}
                          {rowsOf((r) => r.reason === "no_flat", parsed.warnings).join(", ")}
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                  {m ? (
                    <p className="mt-2 pl-6">
                      {m} {plural(m, "wiersz", "wiersze", "wierszy")} bez numeru mieszkania scalono
                      z wcześniejszymi (ten sam budynek, dzień, cena i powierzchnia).
                    </p>
                  ) : null}
                </div>

                {phase.kind === "running" ? (
                  <div className="flex flex-col gap-1.5" aria-live="polite">
                    <p className="text-sm">
                      Importowanie i ustalanie lokalizacji: {phase.done} z {phase.total}{" "}
                      {plural(phase.total, "wiersza", "wierszy", "wierszy")}…
                    </p>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-[var(--accent-700)] transition-all"
                        style={{
                          width: `${phase.total ? Math.round((100 * phase.done) / phase.total) : 100}%`,
                        }}
                      />
                    </div>
                  </div>
                ) : null}
                {phase.kind === "failed" ? (
                  <p
                    role="alert"
                    className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
                  >
                    {phase.message} Zaimportowano {phase.done} z {phase.total} wierszy — powtórny
                    import tego pliku dopisze tylko brakujące (klucz jest treściowy).
                  </p>
                ) : null}
                {done ? (
                  <div className="rounded-lg border border-[var(--accent-100)] bg-[var(--accent-050)] p-4 text-sm">
                    <p className="flex items-center gap-2 font-semibold text-[var(--accent-700)]">
                      <Check className="size-4" /> Import zakończony.
                    </p>
                    <p className="mt-1">
                      Dodano <b className="font-mono">{done.inserted}</b>{" "}
                      {plural(done.inserted, "nowy wiersz", "nowe wiersze", "nowych wierszy")},{" "}
                      <b className="font-mono">{done.duplicates}</b>{" "}
                      {plural(done.duplicates, "duplikat", "duplikaty", "duplikatów")} (w pliku i
                      już w rejestrze), lokalizacja ustalona dla{" "}
                      <b className="font-mono">{done.geocoded}</b>, do poprawki{" "}
                      <b className="font-mono">{done.needsFix}</b>.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <Button asChild>
                        <Link href="/rejestr">Przejdź do rejestru</Link>
                      </Button>
                      <Button asChild variant="outline">
                        <Link href="/rejestr/import">Importuj kolejny plik</Link>
                      </Button>
                    </div>
                  </div>
                ) : null}

                {!done ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Button
                      variant="outline"
                      onClick={() => setStep(2)}
                      disabled={phase.kind === "running"}
                    >
                      ← Wstecz
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      Wiersze trafią do wspólnego rejestru biura; mapowanie zapamiętamy dla SM „
                      {cooperative}”.
                    </span>
                    <Button onClick={runImport} disabled={phase.kind === "running" || n === 0}>
                      <Upload data-icon="inline-start" />
                      Importuj {n} {plural(n, "wiersz", "wiersze", "wierszy")}
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })()}
        </Card>
      ) : null}
    </div>
  );
}

function Stepper({ step }: { step: 1 | 2 | 3 }) {
  const items = ["1. Plik", "2. Mapowanie kolumn", "3. Podsumowanie"];
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm">
      {items.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const cls =
          n < step
            ? "border-[var(--accent-100)] bg-[var(--accent-050)] text-[var(--accent-700)]"
            : n === step
              ? "border-transparent bg-[var(--accent-700)] text-[#fafafa]"
              : "border-border bg-muted text-muted-foreground";
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-current={n === step ? "step" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium ${cls}`}
            >
              {n < step ? <Check className="size-3.5" /> : null}
              {label}
            </span>
            {i < items.length - 1 ? (
              <ChevronRight className="size-4 text-muted-foreground" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function Card({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
      </div>
      {children}
    </section>
  );
}
