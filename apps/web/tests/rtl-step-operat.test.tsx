// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
vi.mock("@/app/actions/confirm-sample", () => ({ confirmSample: vi.fn() }));
vi.mock("@/app/actions/confirm-subject", () => ({ confirmSubject: vi.fn() }));
vi.mock("@/app/actions/confirm-kw", () => ({ confirmKw: vi.fn() }));
vi.mock("@/app/actions/confirm-features", () => ({ confirmFeatures: vi.fn() }));

import { StepOperat } from "@/app/valuations/[id]/steps/step-operat";
import type { ProseSnapshot } from "@/domain/prose-snapshot";
import type { Valuation } from "@/ports/valuation";
import { approvableInput, confirmedProse, confirmedProseFor } from "./fixtures/valuation-inputs";

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
    expect(screen.getByRole("button", { name: /Zatwierdź operat/i })).toBeDisabled();
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
    expect(screen.getByRole("button", { name: /Zatwierdź operat/i })).toBeDisabled();
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
    expect(screen.getByRole("button", { name: /Zatwierdź operat/i })).toBeDisabled();
  });

  it("shows no blockers once all six sections are confirmed", () => {
    render(<StepOperat valuation={draft(currentProse())} />);

    expect(screen.queryByTestId("gate-blockers")).toBeNull();
    expect(screen.getByRole("button", { name: /Zatwierdź operat/i })).toBeEnabled();
  });

  it("NEXT_PUBLIC_PROSE=off: the same prose-less draft shows no blockers at all", () => {
    vi.stubEnv("NEXT_PUBLIC_PROSE", "off");
    render(<StepOperat valuation={draft(null)} />);

    expect(screen.queryByTestId("gate-blockers")).toBeNull();
    expect(screen.getByRole("button", { name: /Zatwierdź operat/i })).toBeEnabled();
    vi.unstubAllEnvs();
  });
});
