// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SampleTable } from "@/app/valuations/[id]/steps/sample-table";
import type { SampleSelectionSnapshot } from "@/domain/sample-snapshot";
import type { Candidate } from "@/domain/sample-selection";
import type { StreetIndexState } from "@/ports/sample";

afterEach(cleanup);
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

let n = 0;
function cand(over: Partial<Candidate> = {}): Candidate {
  n += 1;
  return {
    transactionId: `T${n}`,
    date: "2026-05-10",
    area: 50,
    pricePerM2: 12000,
    priceTotal: 600000,
    egib: {
      teryt: "306401_1",
      obreb: "0039",
      arkusz: "22",
      dzialka: "13/82",
      budynek: String(n),
      lokal: "1",
    },
    lokalId: `306401_1.0039.AR_22.13/82.${n}_BUD.1_LOK`,
    distanceM: 120,
    floor: 2,
    rooms: 2,
    market: "wtorny",
    share: "1/1",
    transType: "wolnyRynek",
    function: "mieszkalna",
    seller: "osobaFizyczna",
    pos: { x: 1, y: 2 },
    ...over,
  };
}

function snap(proposed: Candidate[]): SampleSelectionSnapshot {
  return {
    version: 3,
    proposed,
    alternates: [],
    flags: {},
    rejectedCounts: {},
    rejected: [],
    manualRejections: [],
    radiusUsedM: 500,
    radiusWalk: [],
    counts: { pool: 1, inRadius: 1, afterHygiene: 1, afterBand: 1, proposed: proposed.length },
    params: { subjectArea: 50, todayMonth: "2026-08" },
  };
}

const READY: StreetIndexState = {
  status: "ready",
  cutoff: "2026-08-13",
  generatedAt: "2026-08-22T10:00:00Z",
};
const noop = () => {};

function renderRows(rows: Candidate[], streetIndex?: StreetIndexState) {
  render(
    <SampleTable
      rows={rows}
      kind="proposed"
      allKeys={rows.map((c) => `${c.transactionId}|${c.lokalId}`)}
      reviewedKeys={new Set()}
      selection={snap(rows)}
      streetView={null}
      streetViewEnabled={false}
      streetIndex={streetIndex}
      selectedKey={null}
      onSelect={noop}
      onToggleInSample={noop}
    />,
  );
  return screen.getAllByRole("row")[1];
}

describe("kolumna Ulica w kroku 3 (Slice 3d)", () => {
  it("pokazuje nazwę Z numerem — rzeczoznawca weryfikuje propozycję na mapie", () => {
    // W operacie numeru nie ma (F-12), ale krok 3 to narzędzie robocze.
    const row = renderRows([cand({ street: "ul. Kościelna", streetNumber: "33A" })], READY);
    expect(within(row).getByText("ul. Kościelna 33A")).toBeInTheDocument();
  });

  it("bez numeru pokazuje samą nazwę, bez wiszącej spacji", () => {
    const row = renderRows([cand({ street: "os. Zwycięstwa", streetNumber: null })], READY);
    expect(within(row).getByText("os. Zwycięstwa")).toBeInTheDocument();
  });

  it("transakcja spoza Poznania: kreska i wyjaśnienie granicy źródła", () => {
    // Eksport GEOPOZ obejmuje samo miasto — to stan trwały, nie usterka.
    const outside = cand({
      street: null,
      egib: {
        teryt: "302107_2",
        obreb: "0001",
        arkusz: "",
        dzialka: "15/2",
        budynek: "1",
        lokal: "3",
      },
      lokalId: "302107_2.0001.15/2.1_BUD.3_LOK",
    });
    const row = renderRows([outside], READY);
    expect(within(row).getByTitle(/spoza Poznania/i)).toBeInTheDocument();
  });

  it("indeks w trakcie budowy: instrukcja, nie fałszywe „nieopublikowany”", () => {
    const row = renderRows([cand({ street: null })], { ...READY, status: "building" });
    expect(within(row).getByTitle(/wczytuj/i)).toBeInTheDocument();
  });

  it("pula sprzed slice'u (bez streetIndex): każe pobrać próbę ponownie", () => {
    // reselectSample nie woła workera, więc taka pula NIGDY sama nie dostanie adresów —
    // odznaka „adres jeszcze nieopublikowany” byłaby tu nieprawdą.
    const row = renderRows([cand({ street: undefined })], undefined);
    expect(within(row).getByTitle(/pobierz próbę/i)).toBeInTheDocument();
  });

  it("indeks gotowy, a adresu brak: mówi z którego eksportu", () => {
    const row = renderRows([cand({ street: null })], READY);
    expect(within(row).getByTitle(/2026-08/)).toBeInTheDocument();
  });

  it("nieparsowalny lokalId nie udaje transakcji spoza Poznania", () => {
    const row = renderRows([cand({ street: null, egib: null, lokalId: "śmieć" })], READY);
    expect(within(row).queryByTitle(/spoza Poznania/i)).not.toBeInTheDocument();
  });
});
