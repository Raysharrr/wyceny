// @vitest-environment jsdom
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/**
 * Step 6 ("Sekcje opisowe") — the prose editors, the auto-generation on
 * entry, the confirm-on-submit path and the kill-switch (ADR-014, FR-6, T6).
 *
 * Three properties here are worth more than the rest:
 *
 *  - **Exactly one generation per entry.** A generation costs real money, so
 *    the assertions are on the CALL COUNT and the step renders inside
 *    `<StrictMode>` — React double-invokes mount effects there, which is
 *    precisely the double-fire the `useRef` guard exists to stop.
 *  - **Honest silence.** A section the automat did not write shows an empty
 *    field and says WHY — it never pretends prose exists.
 *  - **`NEXT_PUBLIC_PROSE=off` renders today's placeholder**, byte for byte,
 *    with zero network calls: the CI smoke walks through this step by
 *    clicking a link labelled exactly "Dalej".
 *
 * F-9: every address, note and number below is invented (ul. Klonowa,
 * m. Nowogród).
 */
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const proposeProseMock = vi.fn();
const confirmProseMock = vi.fn();
const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("@/app/actions/propose-prose", () => ({
  proposeProse: (...a: unknown[]) => proposeProseMock(...a),
}));
vi.mock("@/app/actions/confirm-prose", () => ({
  confirmProse: (...a: unknown[]) => confirmProseMock(...a),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import { StepDescriptions } from "@/app/valuations/[id]/steps/step-descriptions";
import { PROSE_SECTIONS, type ProseSnapshot } from "@/domain/prose-snapshot";

// A FRESH id per test: the step keeps a module-scoped map of in-flight
// generations (that is what stops a back-and-forth between steps from paying
// twice), and module state outlives a test. A test that leaves its promise
// pending would otherwise hand it to the next one.
let vidSeq = 0;
let VID = "";
const AI_TEXT = "Lokal o powierzchni 68,40 m2 obejmuje dwa pokoje z kuchnią.";
const HUMAN_TEXT = "Lokal obejmuje dwa pokoje, kuchnię w aneksie i łazienkę z WC.";

const snapshot = (over: Partial<ProseSnapshot> = {}): ProseSnapshot => ({
  sections: {
    opis_lokalu: { value: AI_TEXT, provenance: { source: "ai", status: "to_verify" } },
  },
  rejected: {},
  factsHash: "a".repeat(64),
  model: "claude-sonnet-5",
  generatedAt: "2026-08-18T07:30:00.000Z",
  ...over,
});

function renderStep(props: Partial<Parameters<typeof StepDescriptions>[0]> = {}) {
  return render(
    <StrictMode>
      <StepDescriptions
        valuationId={VID}
        prose={null}
        upToDate={false}
        generatableSections={[...PROSE_SECTIONS]}
        {...props}
      />
    </StrictMode>,
  );
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  VID = `11111111-2222-3333-4444-${String(++vidSeq).padStart(12, "0")}`;
  proposeProseMock.mockReset();
  confirmProseMock.mockReset();
  pushMock.mockReset();
  refreshMock.mockReset();
  proposeProseMock.mockResolvedValue({ prose: snapshot() });
  confirmProseMock.mockResolvedValue(undefined);
});

describe("auto-generation on entering the step", () => {
  it("no proposal yet: shows the loading state and calls the action EXACTLY ONCE", async () => {
    const pending = deferred<{ prose: ProseSnapshot }>();
    proposeProseMock.mockReturnValue(pending.promise);

    renderStep();

    expect(await screen.findByTestId("prose-generating")).toBeInTheDocument();
    expect(proposeProseMock).toHaveBeenCalledTimes(1);
    expect(proposeProseMock).toHaveBeenCalledWith(VID);

    // The response settling re-renders the step — it must not re-fire.
    pending.resolve({ prose: snapshot() });
    await waitFor(() => expect(screen.queryByTestId("prose-generating")).not.toBeInTheDocument());
    expect(proposeProseMock).toHaveBeenCalledTimes(1);
  });

  it("leaving and re-entering mid-flight joins the running generation, it does not buy a second", async () => {
    // Step 5 -> 6 -> back -> 6 again during the ~10 s call. Nothing is
    // persisted yet, so the second mount sees `prose: null` and would start its
    // own paid generation; a per-component ref cannot see across mounts.
    const pending = deferred<{ prose: ProseSnapshot }>();
    proposeProseMock.mockReturnValue(pending.promise);

    const first = renderStep();
    await waitFor(() => expect(proposeProseMock).toHaveBeenCalledTimes(1));
    first.unmount();
    renderStep();

    await screen.findByTestId("prose-generating");
    expect(proposeProseMock).toHaveBeenCalledTimes(1);

    // …and the re-entering mount still gets the result it is waiting for.
    pending.resolve({ prose: snapshot() });
    await waitFor(() => expect(screen.getByLabelText(/Opis lokalu/)).toHaveValue(AI_TEXT));
    expect(proposeProseMock).toHaveBeenCalledTimes(1);
  });

  it("a response arriving after the appraiser left the step touches nothing", async () => {
    const pending = deferred<{ prose: ProseSnapshot }>();
    proposeProseMock.mockReturnValue(pending.promise);

    const { unmount } = renderStep();
    await waitFor(() => expect(proposeProseMock).toHaveBeenCalledTimes(1));
    unmount();

    pending.resolve({ prose: snapshot() });
    await Promise.resolve();
    // `router.refresh()` from a dead component is a real side effect on a page
    // the appraiser has already navigated to.
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("proposals still describe this draft: NOTHING is generated", async () => {
    renderStep({ prose: snapshot(), upToDate: true });

    await waitFor(() => expect(screen.getByLabelText(/Opis lokalu/)).toHaveValue(AI_TEXT));
    expect(proposeProseMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("prose-badge-opis_lokalu")).toHaveTextContent("AI — do weryfikacji");
  });

  it("the draft moved on since the proposals were written: generation fires", async () => {
    renderStep({ prose: snapshot(), upToDate: false });

    await waitFor(() => expect(proposeProseMock).toHaveBeenCalledTimes(1));
  });

  it("nothing the facts can back: no call at all, and the fields stay empty", async () => {
    renderStep({ generatableSections: [] });

    await waitFor(() => expect(screen.getByLabelText(/Opis lokalu/)).toHaveValue(""));
    expect(proposeProseMock).not.toHaveBeenCalled();
  });

  it("every section is already the appraiser's: no generation, even on a moved-on draft", async () => {
    // The merge would preserve all of them, so the call would bill a
    // generation whose every section is then discarded.
    const allConfirmed = snapshot({
      sections: Object.fromEntries(
        PROSE_SECTIONS.map((s) => [
          s,
          { value: HUMAN_TEXT, provenance: { source: "rzeczoznawca", status: "confirmed" } },
        ]),
      ),
    });

    renderStep({ prose: allConfirmed, upToDate: false });

    await waitFor(() => expect(screen.getByLabelText(/Opis lokalu/)).toHaveValue(HUMAN_TEXT));
    expect(proposeProseMock).not.toHaveBeenCalled();
  });

  it("a failed generation shows the action's own Polish message", async () => {
    proposeProseMock.mockResolvedValue({
      error: "Nie udało się wygenerować opisów — spróbuj ponownie.",
    });

    renderStep();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nie udało się wygenerować opisów — spróbuj ponownie.",
    );
  });

  it("a confirmed section survives a regeneration that would have replaced it", async () => {
    // The repo merges server-side; the screen must show what was PERSISTED,
    // not the raw proposal, or the appraiser sees their text vanish.
    const confirmed = snapshot({
      sections: {
        opis_lokalu: {
          value: HUMAN_TEXT,
          provenance: { source: "rzeczoznawca", status: "confirmed" },
        },
      },
    });
    proposeProseMock.mockResolvedValue({ prose: snapshot() });

    renderStep({ prose: confirmed, upToDate: false });

    await waitFor(() => expect(proposeProseMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText(/Opis lokalu/)).toHaveValue(HUMAN_TEXT));
    expect(screen.getByTestId("prose-badge-opis_lokalu")).toHaveTextContent(
      "Rzeczoznawca — potwierdzone",
    );
  });

  it("prose inherited by a new version reads 'do weryfikacji' — the gate blocks it (T7)", () => {
    // The state `newVersionOf` now creates: the appraiser's own text, carried
    // over, with its confirmation reset. A badge saying "potwierdzone" here
    // would contradict the blocker waiting on the very next step.
    const inherited = snapshot({
      sections: {
        opis_lokalu: {
          value: HUMAN_TEXT,
          provenance: { source: "rzeczoznawca", status: "to_verify" },
        },
      },
    });

    renderStep({ prose: inherited, upToDate: true });

    expect(screen.getByTestId("prose-badge-opis_lokalu")).toHaveTextContent(
      "Rzeczoznawca — do weryfikacji",
    );
    expect(screen.getByLabelText(/Opis lokalu/)).toHaveValue(HUMAN_TEXT);
  });
});

describe("sections the automat cannot fill — honest silence", () => {
  it("rejected numbers: empty field, and the offending numbers are shown", async () => {
    renderStep({
      prose: snapshot({ sections: {}, rejected: { analiza_rynku: ["9 871,00", "1 234,00"] } }),
      upToDate: true,
    });

    expect(screen.getByLabelText(/Analiza i charakterystyka rynku/)).toHaveValue("");
    const hint = screen.getByTestId("prose-hint-analiza_rynku");
    expect(hint).toHaveTextContent("liczb spoza danych wyceny");
    expect(hint).toHaveTextContent("9 871,00");
    expect(hint).toHaveTextContent("1 234,00");
  });

  it("an empty rejection list means the call itself failed", async () => {
    renderStep({
      prose: snapshot({ sections: {}, rejected: { uzasadnienie: [] } }),
      upToDate: true,
    });

    expect(screen.getByTestId("prose-hint-uzasadnienie")).toHaveTextContent(
      "Nie udało się wygenerować tej sekcji",
    );
  });

  it("a section skipped for lack of data says WHICH data is missing", async () => {
    renderStep({
      prose: snapshot({ sections: {} }),
      upToDate: true,
      generatableSections: ["analiza_rynku"],
    });

    expect(screen.getByTestId("prose-hint-opis_lokalu")).toHaveTextContent(
      "Brak notatki z oględzin",
    );
    // A section the facts CAN back carries no missing-DATA hint — it was asked
    // for. It still owes an explanation, though (next test).
    expect(screen.getByTestId("prose-hint-analiza_rynku")).not.toHaveTextContent(
      "Brak notatki z oględzin",
    );
  });

  it("a requested section that came back with neither text nor a reason still explains itself", async () => {
    // Honest silence has no third state: an empty box with no explanation is
    // the one outcome this step must never produce.
    renderStep({ prose: snapshot({ sections: {} }), upToDate: true });

    expect(screen.getByTestId("prose-hint-analiza_rynku")).toHaveTextContent(
      "Nie udało się wygenerować tej sekcji",
    );
  });

  it("but an unstarted draft shows no failure hints — nothing has been attempted yet", async () => {
    const pending = deferred<{ prose: ProseSnapshot }>();
    proposeProseMock.mockReturnValue(pending.promise);

    renderStep({ prose: null });

    await screen.findByTestId("prose-generating");
    expect(screen.queryByTestId("prose-hint-analiza_rynku")).not.toBeInTheDocument();
  });
});

describe("the appraiser's responsibility", () => {
  it("the annotation is on the step regardless of what the fields hold", async () => {
    renderStep({ prose: snapshot(), upToDate: true });

    expect(screen.getByTestId("prose-disclaimer")).toHaveTextContent(
      "Propozycja wygenerowana automatycznie — za treść operatu odpowiada rzeczoznawca.",
    );
  });

  it("submit sends all six fields as plain text and moves on to step 7", async () => {
    renderStep({ prose: snapshot(), upToDate: true });

    fireEvent.change(screen.getByLabelText(/Opis lokalu/), { target: { value: HUMAN_TEXT } });
    fireEvent.click(screen.getByRole("button", { name: "Zatwierdź opisy i dalej" }));

    await waitFor(() => expect(confirmProseMock).toHaveBeenCalledTimes(1));
    expect(confirmProseMock).toHaveBeenCalledWith(VID, {
      analiza_rynku: "",
      opis_lokalu: HUMAN_TEXT,
      otoczenie: "",
      zagospodarowanie: "",
      standard: "",
      uzasadnienie: "",
    });
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/valuations/${VID}?step=7`));
  });

  it("a failed save keeps the appraiser on the step with the reason", async () => {
    confirmProseMock.mockResolvedValue({
      error: "Nie udało się zapisać opisów — spróbuj ponownie.",
    });

    renderStep({ prose: snapshot(), upToDate: true });
    fireEvent.click(screen.getByRole("button", { name: "Zatwierdź opisy i dalej" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się zapisać opisów");
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("'Wygeneruj ponownie' re-runs the same action and says what it will and will not overwrite", async () => {
    renderStep({ prose: snapshot(), upToDate: true });

    const note = screen.getByTestId("prose-regenerate-note");
    expect(note).toHaveTextContent("nadpisze niezapisane teksty");
    expect(note).toHaveTextContent("zatwierdzone teksty nie zostaną nadpisane");

    fireEvent.click(screen.getByRole("button", { name: "Wygeneruj ponownie" }));

    await waitFor(() => expect(proposeProseMock).toHaveBeenCalledTimes(1));
    expect(proposeProseMock).toHaveBeenCalledWith(VID);
  });
});

describe("kill-switch NEXT_PUBLIC_PROSE=off", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_PROSE", "off"));

  it("renders the placeholder card heading and copy", () => {
    renderStep();

    expect(screen.getByRole("heading", { name: "Opisy" })).toBeInTheDocument();
    expect(
      screen.getByText(/Generator prozy sekcji opisowych \(FR-6\) — w przygotowaniu/),
    ).toBeInTheDocument();
  });

  it("renders the FootNav back link (step 5) and primary 'Dalej' link (step 7) with correct targets", () => {
    renderStep();

    expect(screen.getByRole("link", { name: /Wstecz/ })).toHaveAttribute(
      "href",
      `/valuations/${VID}?step=5`,
    );
    // e2e/smoke.spec.ts clicks this exact role+name to advance past step 6 —
    // the label must stay byte-identical to "Dalej".
    expect(screen.getByRole("link", { name: "Dalej" })).toHaveAttribute(
      "href",
      `/valuations/${VID}?step=7`,
    );
  });

  it("shows the FootNav mid copy", () => {
    renderStep();

    expect(screen.getByText("Opisy z szablonu przy zatwierdzeniu")).toBeInTheDocument();
  });

  it("generates NOTHING — no editors, no network", async () => {
    renderStep({ prose: null, upToDate: false });

    await waitFor(() => expect(screen.getByRole("heading", { name: "Opisy" })).toBeInTheDocument());
    expect(proposeProseMock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/Opis lokalu/)).not.toBeInTheDocument();
  });
});
