// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

/**
 * Ekran `/profile` po ADR-020 cz. 1 — dane autora i kopia polisy ubezpieczeniowej obok istniejącego
 * skanu podpisu. Dane w testach są FIKCYJNE (F-9).
 */
const saveAuthorProfile = vi.hoisted(() => vi.fn());
const uploadInsurancePage = vi.hoisted(() => vi.fn());
const finishInsuranceUpload = vi.hoisted(() => vi.fn());
const mintKwUploadToken = vi.hoisted(() => vi.fn());
const renderPdfPages = vi.hoisted(() => vi.fn());

vi.mock("@/app/actions/save-profile", () => ({
  saveAuthorProfile,
  uploadInsurancePage,
  finishInsuranceUpload,
}));
vi.mock("@/app/actions/mint-kw-token", () => ({ mintKwUploadToken }));
vi.mock("@/lib/pdf-pages-client", () => ({ renderPdfPages }));

import { AuthorForm } from "@/app/profile/author-form";
import { InsuranceForm } from "@/app/profile/insurance-form";

afterEach(cleanup);
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

beforeEach(() => {
  vi.clearAllMocks();
  mintKwUploadToken.mockResolvedValue({ token: "tok" });
  uploadInsurancePage.mockResolvedValue(undefined);
  finishInsuranceUpload.mockResolvedValue(undefined);
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(UPLOAD_ID);
});

const UPLOAD_ID = "11111111-2222-4333-8444-555555555555" as const;
const pdfFile = () => new File(["%PDF-1.4"], "polisa.pdf", { type: "application/pdf" });

describe("AuthorForm", () => {
  it("wysyła trzy pola autora i pokazuje potwierdzenie zapisu", async () => {
    render(<AuthorForm profile={null} />);
    await userEvent.type(screen.getByLabelText(/imię i nazwisko/i), "Jan Testowy");
    await userEvent.type(screen.getByLabelText(/numer uprawnień/i), "0000");
    await userEvent.type(screen.getByLabelText(/dane biura/i), "Biuro Testowe");
    await userEvent.click(screen.getByRole("button", { name: /zapisz dane autora/i }));

    await waitFor(() => expect(saveAuthorProfile).toHaveBeenCalledOnce());
    const form = saveAuthorProfile.mock.calls[0][0] as FormData;
    expect(form.get("fullName")).toBe("Jan Testowy");
    expect(form.get("licenseNo")).toBe("0000");
    expect(form.get("officeBlock")).toBe("Biuro Testowe");
    expect(await screen.findByText("Zapisano.")).toBeInTheDocument();
  });

  it("pokazuje błąd pola zwrócony przez akcję", async () => {
    saveAuthorProfile.mockResolvedValueOnce({
      fieldErrors: { licenseNo: "Podaj numer uprawnień zawodowych." },
    });
    render(<AuthorForm profile={null} />);
    await userEvent.click(screen.getByRole("button", { name: /zapisz dane autora/i }));
    expect(await screen.findByText(/podaj numer uprawnień/i)).toBeInTheDocument();
  });

  it("wypełnia pola danymi z istniejącego profilu", () => {
    render(
      <AuthorForm
        profile={{
          fullName: "Anna Fikcyjna",
          licenseNo: "1234",
          officeBlock: "Biuro Fikcyjne",
          insuranceDocKey: null,
          insuranceValidUntil: null,
        }}
      />,
    );
    expect(screen.getByLabelText(/imię i nazwisko/i)).toHaveValue("Anna Fikcyjna");
    expect(screen.getByLabelText(/numer uprawnień/i)).toHaveValue("1234");
  });
});

describe("InsuranceForm", () => {
  it("rasteryzuje PDF i wysyła strony po jednej, w kolejności, potem domyka wgranie", async () => {
    renderPdfPages.mockResolvedValueOnce({
      kind: "ok",
      pages: [
        { blob: new Blob(["s1"]), width: 1, height: 1 },
        { blob: new Blob(["s2"]), width: 1, height: 1 },
      ],
    });
    render(<InsuranceForm hasPolicy={false} validUntil={null} validUntilLabel={null} />);
    await userEvent.upload(screen.getByLabelText(/kopia polisy ubezpieczeniowej/i), pdfFile());
    await userEvent.type(screen.getByLabelText(/ważna do/i), "2027-06-30");
    await userEvent.click(screen.getByRole("button", { name: /zapisz polisę/i }));

    await waitFor(() => expect(finishInsuranceUpload).toHaveBeenCalledOnce());
    expect(uploadInsurancePage.mock.calls.map(([, index]) => index)).toEqual([0, 1]);
    expect(finishInsuranceUpload).toHaveBeenCalledWith(UPLOAD_ID, "2027-06-30");
    expect(await screen.findByText("Zapisano.")).toBeInTheDocument();
  });

  it("odrzuca plik inny niż PDF, nie wołając workera", async () => {
    render(<InsuranceForm hasPolicy={false} validUntil={null} validUntilLabel={null} />);
    await userEvent.upload(
      screen.getByLabelText(/kopia polisy ubezpieczeniowej/i),
      new File(["x"], "polisa.jpg", { type: "image/jpeg" }),
      // `accept` already stops this in the picker; the guard under test is the
      // one that catches a drag-and-drop or a file renamed to .pdf.
      { applyAccept: false },
    );
    await userEvent.type(screen.getByLabelText(/ważna do/i), "2027-06-30");
    await userEvent.click(screen.getByRole("button", { name: /zapisz polisę/i }));

    expect(await screen.findByText("Polisa musi być plikiem PDF.")).toBeInTheDocument();
    expect(renderPdfPages).not.toHaveBeenCalled();
  });

  it("wymaga daty ważności", async () => {
    render(<InsuranceForm hasPolicy={false} validUntil={null} validUntilLabel={null} />);
    await userEvent.upload(screen.getByLabelText(/kopia polisy ubezpieczeniowej/i), pdfFile());
    await userEvent.click(screen.getByRole("button", { name: /zapisz polisę/i }));

    expect(await screen.findByText("Podaj datę ważności polisy.")).toBeInTheDocument();
    expect(renderPdfPages).not.toHaveBeenCalled();
  });

  /** 413/415 z workera niosą zdanie, z którym rzeczoznawca może coś zrobić. */
  it("pokazuje komunikat workera przy odrzuconym PDF", async () => {
    renderPdfPages.mockResolvedValueOnce({
      kind: "error",
      message: "Plik polisy ma za dużo stron (limit 10).",
      retryable: false,
    });
    render(<InsuranceForm hasPolicy={false} validUntil={null} validUntilLabel={null} />);
    await userEvent.upload(screen.getByLabelText(/kopia polisy ubezpieczeniowej/i), pdfFile());
    await userEvent.type(screen.getByLabelText(/ważna do/i), "2027-06-30");
    await userEvent.click(screen.getByRole("button", { name: /zapisz polisę/i }));

    expect(await screen.findByText(/za dużo stron/i)).toBeInTheDocument();
    expect(finishInsuranceUpload).not.toHaveBeenCalled();
  });

  /**
   * Przerwane wgranie NIE przestawia profilu — poprzednia polisa zostaje, a
   * nie zastępuje jej obcięta nowa.
   */
  it("nie domyka wgrania, gdy strona nie doszła", async () => {
    renderPdfPages.mockResolvedValueOnce({
      kind: "ok",
      pages: [
        { blob: new Blob(["s1"]), width: 1, height: 1 },
        { blob: new Blob(["s2"]), width: 1, height: 1 },
      ],
    });
    uploadInsurancePage.mockResolvedValueOnce(undefined);
    uploadInsurancePage.mockResolvedValueOnce({ error: "Nie udało się zapisać strony polisy." });
    render(<InsuranceForm hasPolicy validUntil="2026-01-01" validUntilLabel="01.01.2026" />);
    await userEvent.upload(screen.getByLabelText(/kopia polisy ubezpieczeniowej/i), pdfFile());
    await userEvent.click(screen.getByRole("button", { name: /zapisz polisę/i }));
    await waitFor(() => expect(uploadInsurancePage).toHaveBeenCalledTimes(2));

    expect(await screen.findByText(/nie udało się zapisać strony polisy/i)).toBeInTheDocument();
    expect(finishInsuranceUpload).not.toHaveBeenCalled();
  });

  it("mówi, że polisy nie ma, i że nowy plik zastąpi poprzedni", () => {
    const { unmount } = render(
      <InsuranceForm hasPolicy={false} validUntil={null} validUntilLabel={null} />,
    );
    expect(screen.getByTestId("insurance-missing")).toHaveTextContent(/nie wgrano jeszcze polisy/i);
    unmount();
    render(<InsuranceForm hasPolicy validUntil="2027-06-30" validUntilLabel="30.06.2027" />);
    expect(screen.getByTestId("insurance-current")).toHaveTextContent(/ważna do 30\.06\.2027/i);
  });
});
