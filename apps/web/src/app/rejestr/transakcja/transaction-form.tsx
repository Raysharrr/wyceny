"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import {
  saveCoopTransaction,
  type SaveCoopTransactionInput,
} from "@/app/actions/save-coop-transaction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseCoopNumber } from "@/domain/coop-import";
import { fmtNum } from "@/lib/coop-format";
import { PRICE_KINDS, type PriceKind } from "@/ports/coop-registry";

const NEW_COOP = "__new__";
const SELECT =
  "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const REQ = <span className="text-[#e7000b]"> *</span>;
const PRICE_KIND_LABEL: Record<PriceKind, string> = {
  transakcyjna: "transakcyjna",
  ofertowa: "ofertowa",
  nieustalona: "nieustalona",
};

const UNREADABLE = "Nie udało się odczytać liczby — wpisz np. 48,10 albo 521 885,00.";

type Fields = Record<keyof Omit<SaveCoopTransactionInput, "priceKind" | "rightType">, string>;
const EMPTY: Fields = {
  cooperative: "",
  city: "Poznań",
  date: "",
  address: "",
  buildingNumber: "",
  flatNumber: "",
  area: "",
  priceTotal: "",
  floor: "",
  rooms: "",
  buildYear: "",
  rep: "",
};

export function TransactionForm({ cooperatives }: { cooperatives: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [coopChoice, setCoopChoice] = useState(cooperatives[0] ?? NEW_COOP);
  const [f, setF] = useState<Fields>({ ...EMPTY, cooperative: cooperatives[0] ?? "" });
  const [priceKind, setPriceKind] = useState<PriceKind>("nieustalona");
  const [rightType, setRightType] = useState<"" | "spoldzielcze_wlasnosciowe" | "wlasnosc_lokalu">(
    "",
  );
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [saved, setSaved] = useState<{ needsFix: boolean } | null>(null);

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));
  const cooperative = coopChoice === NEW_COOP ? f.cooperative : coopChoice;
  // m-6: the domain parser — knows Polish register formats and refuses ambiguous "1.234".
  const area = f.area.trim() ? parseCoopNumber(f.area) : null;
  const price = f.priceTotal.trim() ? parseCoopNumber(f.priceTotal) : null;
  const unit = area && price && area > 0 && price > 0 ? fmtNum(price / area) : null;

  const submit = (andNext: boolean) =>
    start(async () => {
      setError(null);
      setSaved(null);
      if (f.area.trim() && area === null) return setError({ message: UNREADABLE, field: "area" });
      if (f.priceTotal.trim() && price === null)
        return setError({ message: UNREADABLE, field: "priceTotal" });
      const r = await saveCoopTransaction({
        ...f,
        cooperative,
        area: area ?? "",
        priceTotal: price ?? "",
        floor: f.floor || null,
        rooms: f.rooms || null,
        buildYear: f.buildYear || null,
        rep: f.rep || null,
        priceKind,
        rightType: rightType || null,
      });
      if (!r.ok) return setError({ message: r.error, field: r.field });
      if (andNext) {
        // Keeps cooperative, city and price kind — the next row is usually from the
        // same source. Right type is reset: a legal attribute chosen per row (m-5).
        setF((p) => ({ ...EMPTY, cooperative: p.cooperative, city: p.city }));
        setRightType("");
        setSaved({ needsFix: r.needsFix });
      } else {
        router.push(r.needsFix ? "/rejestr?lokalizacja=do-poprawki&okres=all" : "/rejestr");
      }
    });

  const field = (
    k: keyof Fields,
    label: React.ReactNode,
    props: React.ComponentProps<typeof Input> = {},
    hint?: React.ReactNode,
  ) => (
    <label className="flex flex-col gap-1 text-sm font-medium">
      <span>{label}</span>
      <Input
        value={f[k]}
        onChange={set(k)}
        aria-invalid={error?.field === k || undefined}
        {...props}
      />
      {hint ? <span className="text-xs font-normal text-muted-foreground">{hint}</span> : null}
    </label>
  );

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pending) submit(false); // NIT-6: Enter while saving must not double-submit
      }}
    >
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-[15px] font-semibold">Transakcja</h2>
          <span className="text-xs text-muted-foreground">pola oznaczone * są wymagane</span>
        </div>
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
                value={f.cooperative}
                onChange={set("cooperative")}
                placeholder="np. SM „Osiedle Młodych”"
                aria-label="Nazwa nowej spółdzielni"
              />
            ) : null}
          </div>
          {field("date", <>Data transakcji{REQ}</>, { type: "date" })}
          {field("address", <>Adres (ulica / osiedle){REQ}</>, { placeholder: "os. Piastowskie" })}
          {field("buildingNumber", <>Nr budynku{REQ}</>)}
          {field("flatNumber", <>Nr mieszkania{REQ}</>)}
          {field("area", <>Powierzchnia (m²){REQ}</>, {
            inputMode: "decimal",
            placeholder: "48,10",
          })}
          {field(
            "priceTotal",
            <>Cena (zł){REQ}</>,
            { inputMode: "decimal", placeholder: "521 885,00" },
            <>
              Cena jednostkowa: <b className="font-mono">{unit ? `${unit} zł/m²` : "—"}</b> —
              liczona automatycznie.
            </>,
          )}
          <label className="flex flex-col gap-1 text-sm font-medium">
            <span>Rodzaj prawa</span>
            <select
              className={SELECT}
              value={rightType}
              onChange={(e) => setRightType(e.target.value as typeof rightType)}
            >
              <option value="spoldzielcze_wlasnosciowe">
                Spółdzielcze własnościowe prawo do lokalu
              </option>
              <option value="wlasnosc_lokalu">Własność lokalu</option>
              <option value="">Nieznany</option>
            </select>
            <span className="text-xs font-normal text-muted-foreground">
              Zostawione puste daje odznakę „prawo nieznane” w kroku 3.
            </span>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            <span>Rodzaj ceny</span>
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
              Rejestry spółdzielni nie zawsze rozróżniają cenę ofertową od transakcyjnej — jeśli nie
              wiesz, zostaw «nieustalona».
            </span>
          </label>
          {field(
            "city",
            <>Miasto{REQ}</>,
            {},
            "Miasto, w którym leży lokal — bez niego nie ustalimy lokalizacji.",
          )}
          {field("floor", "Piętro", { inputMode: "numeric" })}
          {field("rooms", "Pokoje", { inputMode: "numeric" })}
          {field("buildYear", "Rok budowy", { inputMode: "numeric", placeholder: "np. 1974" })}
          {field(
            "rep",
            <>
              Rep. aktu{" "}
              <span className="text-xs font-normal text-muted-foreground">(opcjonalnie)</span>
            </>,
            { placeholder: "Rep. A nr 4182/2025" },
            "Numer repertorium — do odszukania aktu, nie trafia do operatu.",
          )}
        </div>
      </section>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
        >
          {error.message}
        </p>
      ) : null}
      {saved ? (
        <p
          role="status"
          className={`rounded-lg border px-4 py-2 text-sm ${saved.needsFix ? "border-[#ecd9a6] bg-[#fbf2dd] text-[#b07a16]" : "border-[var(--accent-100)] bg-[var(--accent-050)] text-[var(--accent-700)]"}`}
        >
          <Check className="mr-1 inline size-4" />
          {saved.needsFix
            ? "Zapisano, ale nie udało się ustalić lokalizacji — transakcja trafiła na listę „do poprawki” i nie wejdzie do doboru po promieniu, dopóki nie poprawisz adresu."
            : "Zapisano transakcję, lokalizacja ustalona."}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline">
          <Link href="/rejestr">Anuluj</Link>
        </Button>
        <span className="flex-1" />
        <Button type="button" variant="outline" disabled={pending} onClick={() => submit(true)}>
          Zapisz i dodaj kolejną
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Zapisywanie…" : "Zapisz transakcję"}
        </Button>
      </div>
    </form>
  );
}
