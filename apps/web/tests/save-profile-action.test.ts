import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Guards of the three `/profile` Server Actions (ADR-020 cz. 1). `_deps` is
 * automocked exactly as `save-signature-action.test.ts` does it, so no real
 * Postgres call leaves the process and `profileRepository` / `storage` become
 * controllable spies.
 *
 * Dane w testach są FIKCYJNE (F-9, ryzyko R10 specu).
 */
vi.mock("@/auth/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "u1", role: "appraiser" } })),
}));

vi.mock("@/app/valuations/_deps");

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

import {
  finishInsuranceUpload,
  saveAuthorProfile,
  uploadInsurancePage,
} from "../src/app/actions/save-profile";
import { profileRepository, storage } from "@/app/valuations/_deps";
import { StorageNotFoundError } from "@/ports/storage";

const saveAuthorMock = vi.mocked(profileRepository.saveAuthor);
const saveInsuranceMock = vi.mocked(profileRepository.saveInsurance);
const storagePutMock = vi.mocked(storage.put);
const storageGetMock = vi.mocked(storage.get);

const UPLOAD_ID = "11111111-2222-4333-8444-555555555555";

const authorForm = (over: Partial<Record<string, string>> = {}): FormData => {
  const form = new FormData();
  form.set("fullName", over.fullName ?? "Jan Testowy");
  form.set("licenseNo", over.licenseNo ?? "0000");
  form.set("officeBlock", over.officeBlock ?? "Biuro Testowe\nul. Przykładowa 1");
  return form;
};

/** Pierwsze trzy bajty prawdziwego JPEG — reszta jest bez znaczenia dla bramki. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

const pageForm = (bytes: Uint8Array = JPEG, type = "image/jpeg", name = "page-1.jpg"): FormData => {
  const form = new FormData();
  form.set("page", new File([bytes.buffer as ArrayBuffer], name, { type }));
  return form;
};

beforeEach(() => {
  saveAuthorMock.mockReset();
  saveInsuranceMock.mockReset();
  storagePutMock.mockReset();
  storagePutMock.mockResolvedValue("/api/docs/x");
  storageGetMock.mockReset();
  // Domyślnie pierwsza strona istnieje — `finishInsuranceUpload` odmawia, gdy
  // nie doszła żadna, i ma na to własny przypadek niżej.
  storageGetMock.mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff]));
});

describe("saveAuthorProfile", () => {
  it("zapisuje trzy pola autora dla zalogowanego rzeczoznawcy", async () => {
    expect(await saveAuthorProfile(authorForm())).toBeUndefined();
    expect(saveAuthorMock).toHaveBeenCalledWith("u1", {
      fullName: "Jan Testowy",
      licenseNo: "0000",
      officeBlock: "Biuro Testowe\nul. Przykładowa 1",
    });
  });

  it.each([
    ["fullName", "Podaj imię i nazwisko."],
    ["licenseNo", "Podaj numer uprawnień zawodowych."],
    ["officeBlock", "Podaj dane biura."],
  ])("odmawia zapisu z pustym polem %s", async (pole, komunikat) => {
    const result = await saveAuthorProfile(authorForm({ [pole]: "   " }));
    expect(result!.fieldErrors).toEqual({ [pole]: komunikat });
    expect(saveAuthorMock).not.toHaveBeenCalled();
  });

  it("zgłasza wszystkie braki naraz, nie po jednym", async () => {
    const form = new FormData();
    const result = await saveAuthorProfile(form);
    expect(Object.keys(result!.fieldErrors!)).toEqual(["fullName", "licenseNo", "officeBlock"]);
  });

  it("przycina białe znaki wokół wpisanych danych", async () => {
    await saveAuthorProfile(authorForm({ fullName: "  Jan Testowy  " }));
    expect(saveAuthorMock.mock.calls[0][1].fullName).toBe("Jan Testowy");
  });

  it("zwraca komunikat z kodem, gdy zapis do bazy padnie", async () => {
    saveAuthorMock.mockRejectedValueOnce(new Error("db unreachable"));
    const result = await saveAuthorProfile(authorForm());
    expect(result!.error).toContain("Nie udało się zapisać profilu");
  });
});

describe("uploadInsurancePage", () => {
  it("zapisuje stronę pod prefiksem wgrania, z numerem dopełnionym zerami", async () => {
    expect(await uploadInsurancePage(UPLOAD_ID, 0, pageForm())).toBeUndefined();
    expect(await uploadInsurancePage(UPLOAD_ID, 9, pageForm())).toBeUndefined();
    expect(storagePutMock.mock.calls.map(([key]) => key)).toEqual([
      `polisa/u1/${UPLOAD_ID}/page-001.jpg`,
      `polisa/u1/${UPLOAD_ID}/page-010.jpg`,
    ]);
  });

  /**
   * `uploadId` wchodzi w klucz storage, więc jest walidowany jak każde wejście
   * z przeglądarki — inaczej wywołanie mogłoby zapisać obok cudzego prefiksu.
   */
  it.each(["../inny", "u2/polisa", "", "NIE-UUID"])(
    "odrzuca identyfikator wgrywania %s",
    async (uploadId) => {
      const result = await uploadInsurancePage(uploadId, 0, pageForm());
      expect(result!.error).toBe("Nieprawidłowy identyfikator wgrywania.");
      expect(storagePutMock).not.toHaveBeenCalled();
    },
  );

  it.each([-1, 10, 1.5])("odrzuca numer strony %s", async (pageIndex) => {
    const result = await uploadInsurancePage(UPLOAD_ID, pageIndex, pageForm());
    expect(result!.error).toBe("Nieprawidłowy numer strony polisy.");
    expect(storagePutMock).not.toHaveBeenCalled();
  });

  it("odrzuca pustą stronę", async () => {
    const form = new FormData();
    form.set("page", new File([], "page.jpg", { type: "image/jpeg" }));
    const result = await uploadInsurancePage(UPLOAD_ID, 0, form);
    expect(result!.error).toBe("Brak strony polisy do zapisania.");
  });

  /**
   * Bajty stąd trafiają pełnostronicowo do operatu, więc typ sprawdzany jest
   * dwa razy: zadeklarowany (jak w `save-signature.ts`) i pierwsze trzy bajty,
   * których wołający nie przemianuje. Wzorzec z `save-signature.ts:29`.
   */
  it("odrzuca stronę o zadeklarowanym typie innym niż JPEG", async () => {
    const result = await uploadInsurancePage(UPLOAD_ID, 0, pageForm(JPEG, "application/pdf"));
    expect(result!.error).toBe("Strona polisy musi być obrazem JPEG.");
    expect(storagePutMock).not.toHaveBeenCalled();
  });

  it("odrzuca plik podszywający się pod JPEG samą nazwą i nagłówkiem", async () => {
    const udaje = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
    const result = await uploadInsurancePage(UPLOAD_ID, 0, pageForm(udaje));
    expect(result!.error).toBe("Strona polisy musi być obrazem JPEG.");
    expect(storagePutMock).not.toHaveBeenCalled();
  });

  /** Sam upload NIE przestawia profilu — robi to dopiero finish. */
  it("nie dotyka wiersza profilu", async () => {
    await uploadInsurancePage(UPLOAD_ID, 0, pageForm());
    expect(saveInsuranceMock).not.toHaveBeenCalled();
  });
});

describe("finishInsuranceUpload", () => {
  it("przestawia profil na prefiks wgrania i zapisuje datę ważności", async () => {
    expect(await finishInsuranceUpload(UPLOAD_ID, "2027-06-30")).toBeUndefined();
    expect(saveInsuranceMock).toHaveBeenCalledWith("u1", {
      docKey: `polisa/u1/${UPLOAD_ID}`,
      validUntil: "2027-06-30",
    });
  });

  it.each(["30.06.2027", "2027-6-3", ""])("odrzuca datę w formacie %s", async (validUntil) => {
    const result = await finishInsuranceUpload(UPLOAD_ID, validUntil);
    expect(result!.fieldErrors).toEqual({ insuranceValidUntil: "Podaj datę ważności polisy." });
    expect(saveInsuranceMock).not.toHaveBeenCalled();
  });

  /**
   * B-16 patrzy tylko, czy kolumna jest niepusta, więc klucz wskazujący na
   * nic zdegradowałby bramkę do „istnieje napis” i wypuścił operat z pustym
   * Załącznikiem nr 1.
   */
  it("odmawia, gdy pod prefiksem nie ma ani jednej strony", async () => {
    storageGetMock.mockRejectedValueOnce(new StorageNotFoundError("brak"));
    const result = await finishInsuranceUpload(UPLOAD_ID, "2027-06-30");
    expect(result!.fieldErrors).toEqual({
      policy: "Nie wgrano żadnej strony polisy — spróbuj ponownie.",
    });
    expect(saveInsuranceMock).not.toHaveBeenCalled();
  });

  it("odrzuca obcy identyfikator wgrywania", async () => {
    const result = await finishInsuranceUpload("../u2/x", "2027-06-30");
    expect(result!.error).toBe("Nieprawidłowy identyfikator wgrywania.");
    expect(saveInsuranceMock).not.toHaveBeenCalled();
  });

  it("zwraca komunikat z kodem, gdy zapis do bazy padnie", async () => {
    saveInsuranceMock.mockRejectedValueOnce(new Error("db unreachable"));
    const result = await finishInsuranceUpload(UPLOAD_ID, "2027-06-30");
    expect(result!.error).toContain("Nie udało się zapisać polisy");
  });
});
