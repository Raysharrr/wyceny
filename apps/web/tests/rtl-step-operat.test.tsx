// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

vi.mock("@/app/actions/approve-valuation", () => ({ approveValuation: vi.fn() }));
vi.mock("@/app/actions/sign-valuation", () => ({ signValuationAction: vi.fn() }));
vi.mock("@/app/actions/create-new-version", () => ({ createNewVersionAction: vi.fn() }));
vi.mock("@/app/actions/preview-operat", () => ({ previewOperat: vi.fn() }));

import { StepOperat } from "@/app/valuations/[id]/steps/step-operat";
import { previewOperat } from "@/app/actions/preview-operat";
import type { ProseSnapshot } from "@/domain/prose-snapshot";
import type { Valuation } from "@/ports/valuation";
import { approvableInput, confirmedProse, confirmedProseFor } from "./fixtures/valuation-inputs";

/** What the action hands back: the blob key is stable, so the version is the
 * only thing distinguishing this render from the one it overwrote. */
const PREVIEW_URL = "/api/podglad/valuation-step7-1?v=0123456789abcdef";
const preview = vi.mocked(previewOperat);

beforeEach(() => {
  preview.mockReset();
  preview.mockResolvedValue({ url: PREVIEW_URL });
});

/**
 * Step 7 ("Operat") renders the blocker list the approve action enforces.
 * The two must agree: a blocker the appraiser cannot see, on a button that
 * looks enabled, turns a refusal into a mystery. Both read the same gate —
 * this pins that the kill-switch answer reaches the screen too (Task 7).
 */
const draft = (prose: ProseSnapshot | null): Valuation => ({
  id: "valuation-step7-1",
  address: "ul. Operatowa 3, Poznań",
  area: 55,
  wr: 700_000,
  inputs: { ...approvableInput("test-user").inputs!, prose },
  amountInWords: "siedemset tysięcy złotych",
  docUrl: null,
  docxUrl: null,
  purpose: "sprzedaz",
  kwNumber: "KW-TEST-1",
  client: "Jan Testowy",
  inspectionDate: "2026-07-10",
  ownerId: "test-user",
  status: "in_progress",
  approvedAt: null,
  signedAt: null,
  supersedesId: null,
  mapsFrozenFor: null,
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
});

/** Prose describing THIS draft — anything else reads as stale (I-2). */
const currentProse = () =>
  confirmedProseFor("ul. Operatowa 3, Poznań", approvableInput("test-user").inputs!);

describe("StepOperat — the blocker list matches the approve action (Task 7)", () => {
  it("names the missing prose and keeps the approve button disabled", () => {
    render(<StepOperat valuation={draft(null)} />);

    expect(screen.getByTestId("gate-blockers")).toHaveTextContent(
      "Opisy sekcji nie zostały wygenerowane.",
    );
    expect(screen.getByRole("button", { name: /Zatwierdź i generuj operat/i })).toBeDisabled();
  });

  it("names the section the appraiser has not accepted yet", () => {
    const prose = currentProse();
    prose.sections.standard = {
      value: "Propozycja automatu — dane testowe.",
      provenance: { source: "ai", status: "to_verify" },
    };
    render(<StepOperat valuation={draft(prose)} />);

    expect(screen.getByTestId("gate-blockers")).toHaveTextContent(
      "Opis standardu wykończenia — do weryfikacji.",
    );
  });

  it("names the ONE section that describes a superseded sample (T4)", () => {
    // Six confirmed sections, one of them written against facts that have
    // since moved. The screen has to say which one — the other five still
    // describe this draft, and re-reading them buys nothing.
    const prose = currentProse();
    prose.factsHashes.uzasadnienie = "f".repeat(64);
    render(<StepOperat valuation={draft(prose)} />);

    const blockers = screen.getByTestId("gate-blockers");
    expect(blockers).toHaveTextContent(
      "Uzasadnienie wyniku — pozycja na tle próby — dane się zmieniły, przejrzyj ponownie.",
    );
    expect(blockers).not.toHaveTextContent("Analiza i charakterystyka rynku");
    expect(screen.getByRole("button", { name: /Zatwierdź i generuj operat/i })).toBeDisabled();
  });

  it("names the first section as stale when the snapshot predates per-section fingerprints", () => {
    // The migration path: `confirmedProse()` carries a fingerprint from some
    // earlier state of the draft, so every section reads stale — one pass
    // through step 6 and the draft is current again. Asserted on the first
    // section only; that all six are listed is the gate's own business and
    // `f4-approval-gate.test.ts` counts them there.
    render(<StepOperat valuation={draft(confirmedProse())} />);

    expect(screen.getByTestId("gate-blockers")).toHaveTextContent(
      "Analiza i charakterystyka rynku — dane się zmieniły, przejrzyj ponownie.",
    );
    expect(screen.getByRole("button", { name: /Zatwierdź i generuj operat/i })).toBeDisabled();
  });

  it("shows no blockers once all six sections are confirmed", async () => {
    render(<StepOperat valuation={draft(currentProse())} />);

    expect(screen.queryByTestId("gate-blockers")).toBeNull();
    expect(screen.getByRole("button", { name: /Zatwierdź i generuj operat/i })).toBeEnabled();
    // No blockers means the preview renders by itself — awaited so the
    // resolving action settles inside the test rather than after it.
    await screen.findByTitle("Podgląd operatu (PDF)");
  });

  it("NEXT_PUBLIC_PROSE=off: the same prose-less draft shows no blockers at all", async () => {
    vi.stubEnv("NEXT_PUBLIC_PROSE", "off");
    render(<StepOperat valuation={draft(null)} />);

    expect(screen.queryByTestId("gate-blockers")).toBeNull();
    expect(screen.getByRole("button", { name: /Zatwierdź i generuj operat/i })).toBeEnabled();
    await screen.findByTitle("Podgląd operatu (PDF)");
    vi.unstubAllEnvs();
  });
});

/**
 * T8: step 7 stops confirming. The four bulk buttons asked the appraiser to
 * vouch for transactions, parcels, land-register entries and rating scales
 * that this screen never showed — the complaint the whole slice answers.
 * What replaces them is a report: every blocker names the step that owns it,
 * as a link. Confirming itself moved to steps 1/3/4 in T7.
 */
describe("StepOperat — no bulk confirmation, only links back (Task 8)", () => {
  /** A draft parked in every state a deleted button used to cover. */
  const stuck = (): Valuation => {
    const base = draft(currentProse());
    const inputs = base.inputs!;
    return {
      ...base,
      inputs: {
        ...inputs,
        comparables: inputs.comparables.map((c) => ({ ...c, status: "to_verify" as const })),
        subject: { obreb: "Nowogród", nrDzialki: "12" },
        kw: {
          source: "odpis_kw",
          kwLokalu: "KW-TEST-1",
          kwGruntu: "KW-TEST-1",
          kwInne: [],
          deweloperski: false,
          powUzytkowaKw: 50,
          udzial: null,
          sad: null,
          wydzial: null,
          dataDokumentu: null,
          dzial3: null,
          dzial4: null,
        },
        provenance: {
          ...inputs.provenance!,
          geocode: { source: "geokoder", status: "to_verify" },
          ewidencja: { source: "ewidencja", status: "to_verify" },
          mpzp: { source: "mpzp", status: "to_verify" },
          kw: { source: "odpis_kw", status: "to_verify" },
          weights: { source: "preset", status: "to_verify" },
          featureDefs: { source: "preset", status: "to_verify" },
        },
      },
    };
  };

  it("offers no bulk confirmation, only a link to the step that holds the data", () => {
    render(<StepOperat valuation={stuck()} />);

    for (const testId of [
      "confirm-sample-button",
      "confirm-subject-button",
      "confirm-kw-button",
      "confirm-features-button",
    ]) {
      expect(screen.queryByTestId(testId)).toBeNull();
    }
    expect(screen.getAllByRole("link", { name: /przejdź do kroku 3/i })[0]).toHaveAttribute(
      "href",
      expect.stringContaining("step=3"),
    );
  });

  it("sends each blocker to its own step, not all of them to one", () => {
    render(<StepOperat valuation={stuck()} />);
    const blockers = screen.getByTestId("gate-blockers");

    // The subject group is read on step 1, the sample on step 3, the rating
    // scale on step 4 — the appraiser fixing them one at a time must be able
    // to see all three destinations at once.
    expect(
      within(blockers).getAllByRole("link", { name: /przejdź do kroku 1\. przedmiot/i }).length,
    ).toBeGreaterThan(0);
    expect(
      within(blockers).getAllByRole("link", { name: /przejdź do kroku 3\. próba/i }).length,
    ).toBeGreaterThan(0);
    expect(
      within(blockers).getAllByRole("link", { name: /przejdź do kroku 4\. cechy/i }).length,
    ).toBeGreaterThan(0);
  });

  it("points a stale description at step 6, next to the section it names", () => {
    const prose = currentProse();
    prose.factsHashes.uzasadnienie = "f".repeat(64);
    render(<StepOperat valuation={draft(prose)} />);

    const item = within(screen.getByTestId("gate-blockers"))
      .getByText(/Uzasadnienie wyniku/)
      .closest("li")!;
    expect(within(item).getByRole("link", { name: /przejdź do kroku 6\. opisy/i })).toHaveAttribute(
      "href",
      expect.stringContaining("step=6"),
    );
  });
});

/**
 * T10: step 7 stops describing the operat and starts showing it. Three states
 * (spec §C): **braki** — blockers plus an explicit "preview anyway"; **gotowe**
 * — the render happens by itself and the reader is embedded; **wydany** — as
 * today, and unreachable from here (page.tsx routes a non-draft to the flat
 * view, which embeds `docUrl`).
 */
describe("StepOperat — the document on the screen (Task 10)", () => {
  it("with blockers: no automatic render, an explicit button instead", () => {
    render(<StepOperat valuation={draft(null)} />);

    expect(previewOperat).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Pokaż podgląd mimo braków" })).toBeEnabled();
    expect(screen.queryByTitle("Podgląd operatu (PDF)")).toBeNull();
  });

  it("with blockers: the preview stays a preview — issuing is still refused", async () => {
    render(<StepOperat valuation={draft(null)} />);
    await userEvent.click(screen.getByRole("button", { name: "Pokaż podgląd mimo braków" }));

    await screen.findByTitle("Podgląd operatu (PDF)");
    expect(screen.getByRole("button", { name: /Zatwierdź i generuj operat/i })).toBeDisabled();
  });

  it("without blockers: renders by itself and embeds the reader without its chrome", async () => {
    render(<StepOperat valuation={draft(currentProse())} />);

    const frame = await screen.findByTitle("Podgląd operatu (PDF)");
    expect(frame).toHaveAttribute("src", expect.stringContaining("#toolbar=0&navpanes=0"));
  });

  it("embeds the URL the action returned, version and all", async () => {
    // The blob key is stable and every render overwrites it, so the version
    // the action computed from the bytes is the only thing that stops the
    // reader re-serving the render the appraiser just replaced. Rebuilding
    // the URL from the id would drop it.
    render(<StepOperat valuation={draft(currentProse())} />);

    const frame = await screen.findByTitle("Podgląd operatu (PDF)");
    expect(frame).toHaveAttribute("src", `${PREVIEW_URL}#toolbar=0&navpanes=0`);
    expect(preview.mock.calls[0][0]).toBe("valuation-step7-1");
  });

  it("offers the without-maps path on the preview, and only on an explicit click", async () => {
    // Spec §C: the "bez map" path moves from issuing onto the preview. It is
    // never automatic — `skipMaps` lifts the map freeze and deletes the bytes.
    preview.mockResolvedValueOnce({
      error: "Nie udało się pobrać map do operatu — WMS nie odpowiada.",
      mapsUnavailable: true,
    });
    render(<StepOperat valuation={draft(currentProse())} />);

    const skip = await screen.findByRole("button", { name: "Pokaż podgląd bez map" });
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview).not.toHaveBeenCalledWith("valuation-step7-1", { skipMaps: true });

    await userEvent.click(skip);
    expect(preview).toHaveBeenCalledWith("valuation-step7-1", { skipMaps: true });
    await screen.findByTitle("Podgląd operatu (PDF)");
  });

  it("says why there is nothing to look at when the render fails", async () => {
    preview.mockResolvedValueOnce({
      error: "Brak danych wejściowych operatu — nie ma czego pokazać.",
    });
    render(<StepOperat valuation={draft(currentProse())} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Brak danych wejściowych operatu — nie ma czego pokazać.",
    );
    expect(screen.queryByTitle("Podgląd operatu (PDF)")).toBeNull();
  });
});
