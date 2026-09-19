// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import type { RcnConversion } from "@/ports/rcn-pdf";
import { RcnConverter } from "@/app/narzedzia/rcn-pdf/converter";

/**
 * The four states of `/narzedzia/rcn-pdf` (T-22, makiety 3–6). The screen has
 * NO table preview and no column description (user's decision 19.09) — the
 * result is read in the downloaded workbook, so what it owes the appraiser is
 * counters, a download and an honest refusal.
 */
const convertRcnPdf = vi.hoisted(() => vi.fn());
vi.mock("@/app/actions/rcn-pdf", () => ({ convertRcnPdf }));

const RESULT: RcnConversion = {
  orderNumber: "GKG.GZW.4061.0000.2026",
  unit: "000000_0 - Przykładowo - obszar wiejski",
  count: 2,
  flaggedRows: 1,
  fileWarnings: [],
  xlsxBase64: "UEsDBA==",
};

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function pdf(name = "wydruk-rcn.pdf") {
  return new File([new Uint8Array([37, 80, 68, 70])], name, { type: "application/pdf" });
}

const fileInput = () => screen.getByLabelText("Plik PDF") as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  convertRcnPdf.mockResolvedValue({ result: RESULT });
});
afterEach(cleanup);

describe("RcnConverter — stan pusty", () => {
  it("to sama karta pliku: nic o wyniku, nic o kolumnach", () => {
    render(<RcnConverter />);
    expect(screen.getByText("Plik z portalu")).toBeInTheDocument();
    expect(screen.getByText("PDF „WYDRUK Z RCN”")).toBeInTheDocument();
    expect(screen.getByText("Wybierz plik")).toBeInTheDocument();
    expect(screen.getByText("PDF, do 4 MB")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: /pobierz plik xlsx/i })).toBeNull();
  });
});

describe("RcnConverter — wczytywanie", () => {
  it("mówi, co robi, i blokuje wybór kolejnego pliku", async () => {
    const user = userEvent.setup();
    let release!: (v: unknown) => void;
    convertRcnPdf.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    render(<RcnConverter />);
    await user.upload(fileInput(), pdf());

    expect(await screen.findByText("Odczytywanie transakcji…")).toBeInTheDocument();
    expect(screen.getByText("wydruk-rcn.pdf")).toBeInTheDocument();
    expect(screen.getByText("Zmień plik")).toBeInTheDocument();
    expect(fileInput()).toBeDisabled();

    release({ result: RESULT });
    await screen.findByText("Odczytano 2 transakcje.");
  });
});

describe("RcnConverter — wynik", () => {
  it("podaje licznik, zamówienie, jednostkę i zdanie o wierszach do sprawdzenia", async () => {
    const user = userEvent.setup();
    render(<RcnConverter />);
    await user.upload(fileInput(), pdf());

    expect(await screen.findByText("Odczytano 2 transakcje.")).toBeInTheDocument();
    expect(screen.getByText("GKG.GZW.4061.0000.2026")).toBeInTheDocument();
    expect(screen.getByTestId("rcn-result-summary")).toHaveTextContent(
      "Zamówienie GKG.GZW.4061.0000.2026 · 000000_0 - Przykładowo - obszar wiejski. 1 wiersz wymaga sprawdzenia — w arkuszu ma żółte tło i komentarz.",
    );
    // Nie ma podglądu tabeli ani opisu kolumn (decyzja usera 19.09).
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("RODZAJ BUD")).toBeNull();
  });

  it("przy zerze wierszy do sprawdzenia nie straszy zdaniem o żółtym tle", async () => {
    const user = userEvent.setup();
    convertRcnPdf.mockResolvedValue({ result: { ...RESULT, flaggedRows: 0 } });
    render(<RcnConverter />);
    await user.upload(fileInput(), pdf());

    await screen.findByText("Odczytano 2 transakcje.");
    expect(screen.getByTestId("rcn-result-summary")).toHaveTextContent(
      "Zamówienie GKG.GZW.4061.0000.2026 · 000000_0 - Przykładowo - obszar wiejski.",
    );
    expect(screen.getByTestId("rcn-result-summary").textContent).not.toContain("sprawdzenia");
  });

  it("ostrzeżenie plikowe lp_gap dostaje własny bursztynowy panel", async () => {
    const user = userEvent.setup();
    convertRcnPdf.mockResolvedValue({ result: { ...RESULT, fileWarnings: ["lp_gap"] } });
    render(<RcnConverter />);
    await user.upload(fileInput(), pdf());

    expect(await screen.findByTestId("rcn-file-warnings")).toHaveTextContent(
      "Numeracja transakcji w wydruku ma przerwę — porównaj liczbę wierszy z wydrukiem.",
    );
  });

  it("pobranie robi Blob XLSX i nazywa plik numerem zamówienia", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn((_blob: Blob) => "blob:xlsx");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const clicked: HTMLAnchorElement[] = [];
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });
    try {
      render(<RcnConverter />);
      await user.upload(fileInput(), pdf());
      await user.click(await screen.findByRole("button", { name: /pobierz plik xlsx/i }));

      expect(createObjectURL.mock.calls[0]![0].type).toBe(XLSX_MIME);
      expect(clicked[0]!.download).toBe("GKG.GZW.4061.0000.2026.xlsx");
      expect(clicked[0]!.href).toContain("blob:xlsx");
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:xlsx");
    } finally {
      clickSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("„Wgraj inny plik” wraca do stanu pustego, bez śladu poprzedniego pliku", async () => {
    const user = userEvent.setup();
    render(<RcnConverter />);
    await user.upload(fileInput(), pdf());
    await user.click(await screen.findByRole("button", { name: "Wgraj inny plik" }));

    await waitFor(() => expect(screen.queryByText("Odczytano 2 transakcje.")).toBeNull());
    expect(screen.getByText("Wybierz plik")).toBeInTheDocument();
    expect(screen.getByText("PDF, do 4 MB")).toBeInTheDocument();
    expect(screen.queryByText("wydruk-rcn.pdf")).toBeNull();
    expect(fileInput()).not.toBeDisabled();
  });
});

describe("RcnConverter — błąd", () => {
  it("odrzucona akcja też kończy się komunikatem, nie wiecznym „Odczytywanie…”", async () => {
    const user = userEvent.setup();
    // Akcja może odrzucić, a nie zwrócić błąd: plik ponad limit ciała Server
    // Action, padnięta sesja, deploy w locie.
    convertRcnPdf.mockRejectedValue(new Error("Body exceeded 12mb limit"));
    render(<RcnConverter />);
    await user.upload(fileInput(), pdf());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nie udało się przetworzyć pliku. Spróbuj ponownie.",
    );
    expect(screen.queryByText("Odczytywanie transakcji…")).toBeNull();
    expect(fileInput()).not.toBeDisabled();
  });

  it("pokazuje komunikat akcji dosłownie i zostawia wybór pliku odblokowany", async () => {
    const user = userEvent.setup();
    const message =
      "Nie rozpoznaję tego układu. Narzędzie czyta wydruki „WYDRUK Z RCN” z portalu GEO-INFO i.Rzeczoznawca — wgraj PDF pobrany z zakładki Zamówienia.";
    convertRcnPdf.mockResolvedValue({ error: message });
    render(<RcnConverter />);
    await user.upload(fileInput(), pdf("umowa.pdf"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    expect(fileInput()).not.toBeDisabled();
    // Makieta 6: karta zostaje, z nazwą odrzuconego pliku.
    expect(screen.getByText("umowa.pdf")).toBeInTheDocument();
    expect(screen.getByText("Zmień plik")).toBeInTheDocument();
  });
});
