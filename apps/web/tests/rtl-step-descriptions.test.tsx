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
import { PROSE_SECTIONS, type ProseSection, type ProseSnapshot } from "@/domain/prose-snapshot";

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
  factsHashes: { opis_lokalu: "a".repeat(64) },
  model: "claude-sonnet-5",
  generatedAt: "2026-08-18T07:30:00.000Z",
  ...over,
});

/** All six sections written by the automat and fingerprinted against today's facts. */
const allSixFresh = (over: Partial<ProseSnapshot> = {}): ProseSnapshot =>
  snapshot({
    sections: Object.fromEntries(
      PROSE_SECTIONS.map((s) => [
        s,
        { value: `Tekst sekcji ${s}.`, provenance: { source: "ai", status: "to_verify" } },
      ]),
    ) as ProseSnapshot["sections"],
    factsHashes: Object.fromEntries(PROSE_SECTIONS.map((s) => [s, "a".repeat(64)])),
    ...over,
  });

function renderStep(props: Partial<Parameters<typeof StepDescriptions>[0]> = {}) {
  return render(
    <StrictMode>
      <StepDescriptions
        valuationId={VID}
        prose={null}
        upToDate={false}
        staleSections={[]}
        attemptedSections={[]}
        generatableSections={[...PROSE_SECTIONS]}
        usage={{ generations: 0, tokens: 0, grosze: 0 }}
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
    // `upToDate: true` next to a 1-of-6 snapshot is DELIBERATELY inconsistent
    // with what the server would compute since T5 (a missing generatable
    // section now reads as not up to date). That is the point: what is under
    // test here is that the step TRUSTS the server's aggregate instead of
    // re-deriving it from the snapshot. Make the fixture self-consistent and
    // the property stops being tested at all.
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
    expect(proposeProseMock).toHaveBeenCalledWith(VID, { includeAttempted: true });
  });
});

describe("what went stale, and what regenerating it costs (T5)", () => {
  /**
   * All six written by the automat, then the sample edited underneath one of
   * them. The section is stale AND still the automat's — which is the state
   * an earlier version of this block could not reach, because every stale
   * section it built was `rzeczoznawca`/`confirmed` and therefore dropped by
   * `isStillTheAutomats` before any generation could fire (fix round 1).
   *
   * What keeps these assertions free of a generation in flight is
   * `attemptedSections`, not the provenance: the automat was already asked at
   * these exact facts. The pairs in "entering the step must not re-buy a
   * refusal" prove the same fixture DOES fire without that.
   */
  const oneStale = (): ProseSnapshot => allSixFresh();
  const ATTEMPTED_ANALIZA = { attemptedSections: ["analiza_rynku"] as ProseSection[] };

  it("marks only the stale sections and offers to regenerate just those", () => {
    renderStep({
      prose: oneStale(),
      upToDate: false,
      staleSections: ["analiza_rynku"],
      ...ATTEMPTED_ANALIZA,
    });

    expect(screen.getByTestId("prose-stale-analiza_rynku")).toHaveTextContent("dane się zmieniły");
    expect(screen.queryByTestId("prose-stale-otoczenie")).toBeNull();
    expect(
      screen.getByRole("button", { name: /Wygeneruj ponownie 1 nieaktualną sekcję/ }),
    ).toBeEnabled();
    // Marking is free; only the appraiser's click is not.
    expect(proposeProseMock).not.toHaveBeenCalled();
  });

  it("counts in Polish — two stale sections read 'nieaktualne sekcje'", () => {
    renderStep({
      prose: allSixFresh(),
      upToDate: false,
      staleSections: ["analiza_rynku", "uzasadnienie"],
      attemptedSections: ["analiza_rynku", "uzasadnienie"],
    });

    expect(
      screen.getByRole("button", { name: /Wygeneruj ponownie 2 nieaktualne sekcje/ }),
    ).toBeEnabled();
  });

  it("a stale section the facts can no longer back is marked but not counted", () => {
    // The button would not touch it — `proposeProse` only ever asks for
    // sections today's facts can back — so promising to regenerate it would
    // be a label that does not survive the click.
    renderStep({
      prose: oneStale(),
      upToDate: false,
      staleSections: ["analiza_rynku"],
      ...ATTEMPTED_ANALIZA,
      generatableSections: PROSE_SECTIONS.filter((s) => s !== "analiza_rynku"),
    });

    expect(screen.getByTestId("prose-stale-analiza_rynku")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wygeneruj ponownie" })).toBeInTheDocument();
  });

  it("nothing stale: the button keeps its plain label", () => {
    renderStep({ prose: allSixFresh(), upToDate: true });

    expect(screen.getByRole("button", { name: "Wygeneruj ponownie" })).toBeInTheDocument();
    expect(screen.queryByTestId("prose-stale-analiza_rynku")).toBeNull();
  });

  it("the counted button asks for the missing-or-stale set, not for all six", async () => {
    renderStep({
      prose: oneStale(),
      upToDate: false,
      staleSections: ["analiza_rynku"],
      ...ATTEMPTED_ANALIZA,
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Wygeneruj ponownie 1 nieaktualną sekcję/ }),
    );

    // The server still decides the batch — the browser never re-derives the
    // missing-or-stale rule — but `includeAttempted` marks this as the
    // appraiser ASKING, which lifts the bound the automatic call carries
    // (fix round 2). Without it this click would silently do nothing on a
    // draft whose stale sections were all attempted already, and the only
    // retry left for one refused section would be paying for all six.
    await waitFor(() =>
      expect(proposeProseMock).toHaveBeenCalledWith(VID, { includeAttempted: true }),
    );
  });

  it("the appraiser cannot ask INTO a bounded call already in flight", async () => {
    // Load-bearing, and non-obvious. `inFlight` is keyed by valuation alone
    // (fix round 1), so a click during the automatic call would JOIN it — a
    // bounded run that deliberately left the refused section out — and the ask
    // would be silently swallowed. What prevents it is the disabled state:
    // `generate()` sets `generating` before it awaits anything, so from the
    // first commit after mount both buttons are unclickable until the call
    // settles. Pinned here because the coarse key depends on it.
    const pending = deferred<{ prose: ProseSnapshot }>();
    proposeProseMock.mockReturnValue(pending.promise);

    renderStep({ prose: null, upToDate: false });

    await screen.findByTestId("prose-generating");
    expect(screen.getByRole("button", { name: "Wygeneruj ponownie" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Wygeneruj wszystkie od nowa" })).toBeDisabled();
    expect(proposeProseMock).toHaveBeenCalledTimes(1);
  });

  it("the AUTOMATIC call stays bounded — no options at all", async () => {
    // The pair to the test above: entering the step sends the plain call, so
    // the server leaves out anything it has already been asked for at these
    // facts. Two different intents, two different payloads.
    const pending = deferred<{ prose: ProseSnapshot }>();
    proposeProseMock.mockReturnValue(pending.promise);

    renderStep({ prose: null, upToDate: false });

    await waitFor(() => expect(proposeProseMock).toHaveBeenCalledWith(VID));
  });

  it("'Wygeneruj wszystkie od nowa' names all six explicitly", async () => {
    renderStep({ prose: allSixFresh(), upToDate: true });

    fireEvent.click(screen.getByRole("button", { name: "Wygeneruj wszystkie od nowa" }));

    await waitFor(() =>
      expect(proposeProseMock).toHaveBeenCalledWith(VID, { sections: [...PROSE_SECTIONS] }),
    );
  });

  it("shows what has been spent: generations, the measured tokens, and the cost as an estimate", () => {
    renderStep({
      prose: allSixFresh(),
      upToDate: true,
      usage: { generations: 3, tokens: 12400, grosze: 24 },
    });

    const line = screen.getByTestId("prose-usage");
    expect(line).toHaveTextContent("Wygenerowano 3 razy");
    expect(line).toHaveTextContent("12 400 tokenów");
    // "ok." is not decoration: the token count is measured, the złotówki are
    // derived from a price list that ages.
    expect(line).toHaveTextContent("koszt ok. 0,24 zł");
  });

  it("nothing generated yet: no cost line to misread", () => {
    renderStep({ prose: allSixFresh(), upToDate: true });

    expect(screen.queryByTestId("prose-usage")).toBeNull();
  });
});

describe("a refused refresh is visible, not silent (T5)", () => {
  it("carried-forward text keeps the reason the regeneration was refused", () => {
    // T3 ruling 2 made the snapshot keep BOTH: the old text (still the best
    // available content) and the reason the fresh attempt was thrown away.
    // Rendering only the text is the failure this test exists for — the
    // appraiser clicks regenerate, nothing on screen moves, and nothing says
    // a refusal happened.
    renderStep({
      prose: snapshot({
        sections: {
          otoczenie: { value: AI_TEXT, provenance: { source: "ai", status: "to_verify" } },
        },
        rejected: { otoczenie: ["1 234,00"] },
      }),
      upToDate: true,
    });

    expect(screen.getByLabelText(/Charakterystyka bezpośredniego otoczenia/)).toHaveValue(AI_TEXT);
    const hint = screen.getByTestId("prose-hint-otoczenie");
    expect(hint).toHaveTextContent("Nie udało się odświeżyć tej sekcji");
    expect(hint).toHaveTextContent("1 234,00");
    expect(hint).toHaveTextContent("wcześniejszej generacji");
  });

  it("a refusal with no numbers behind it still says the text is the older one", () => {
    renderStep({
      prose: snapshot({
        sections: {
          otoczenie: { value: AI_TEXT, provenance: { source: "ai", status: "to_verify" } },
        },
        rejected: { otoczenie: [] },
      }),
      upToDate: true,
    });

    const hint = screen.getByTestId("prose-hint-otoczenie");
    expect(hint).toHaveTextContent("Nie udało się odświeżyć tej sekcji");
    expect(hint).toHaveTextContent("wcześniejszej generacji");
  });

  it("text the appraiser owns needs no excuse — the merge keeps it free of refusals", () => {
    renderStep({
      prose: snapshot({
        sections: {
          otoczenie: {
            value: HUMAN_TEXT,
            provenance: { source: "rzeczoznawca", status: "confirmed" },
          },
        },
        rejected: {},
      }),
      upToDate: true,
    });

    expect(screen.queryByTestId("prose-hint-otoczenie")).toBeNull();
  });
});

/**
 * Entering the step must not re-buy an answer the automat has already given
 * (T5 fix round 1).
 *
 * THREE ways a section can be stuck needing work that no further call will
 * produce, and each is a separate probe below, in PAIRS: the same fixture
 * with `attemptedSections` empty must fire exactly once, so a probe that
 * passes for the wrong reason (nothing could fire at all) is visible.
 *
 *  1. **stale + rejected** — AI text that went stale, whose refresh the
 *     worker's number guard refused. The merge keeps the OLD fingerprint, so
 *     it stays stale forever and the no-opts filter re-requests it forever.
 *  2. **requested but silent** — no text, no reason. Nothing in the snapshot
 *     recorded that it was ever asked for.
 *  3. **missing + rejected** — the one case the first round closed.
 *
 * `attempts` closes all three, and the F-4 gate still blocks every one of
 * them: only the automatic RETRY is suppressed, never the blocker.
 */
describe("entering the step must not re-buy an answer already given (T5)", () => {
  const stale = (over: Partial<ProseSnapshot> = {}) => allSixFresh(over);

  const missing = (over: Partial<ProseSnapshot> = {}) => {
    const snapshot = allSixFresh(over);
    delete snapshot.sections.uzasadnienie;
    return snapshot;
  };

  it("PATH 1 stale + rejected, already attempted: NOTHING is bought", async () => {
    renderStep({
      prose: stale({ rejected: { otoczenie: ["9 871,00"] } }),
      upToDate: false,
      staleSections: ["otoczenie"],
      attemptedSections: ["otoczenie"],
    });

    await waitFor(() =>
      expect(screen.getByLabelText(/Opis lokalu/)).toHaveValue("Tekst sekcji opis_lokalu."),
    );
    expect(proposeProseMock).not.toHaveBeenCalled();
    // …and the appraiser can still ask, and is still told the section is stale.
    expect(screen.getByTestId("prose-stale-otoczenie")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Wygeneruj ponownie 1 nieaktualną sekcję/ }),
    ).toBeEnabled();
  });

  it("PATH 1 control — the same stale section NOT yet attempted fires exactly once", async () => {
    const pending = deferred<{ prose: ProseSnapshot }>();
    proposeProseMock.mockReturnValue(pending.promise);

    renderStep({
      prose: stale({ rejected: { otoczenie: ["9 871,00"] } }),
      upToDate: false,
      staleSections: ["otoczenie"],
    });

    await waitFor(() => expect(proposeProseMock).toHaveBeenCalledTimes(1));
  });

  it("PATH 2 requested but silent (no text, no reason), already attempted: NOTHING", async () => {
    renderStep({
      prose: missing(),
      upToDate: false,
      attemptedSections: ["uzasadnienie"],
    });

    await waitFor(() =>
      expect(screen.getByLabelText(/Opis lokalu/)).toHaveValue("Tekst sekcji opis_lokalu."),
    );
    expect(proposeProseMock).not.toHaveBeenCalled();
  });

  it("PATH 2 control — silent and NOT yet attempted fires exactly once", async () => {
    const pending = deferred<{ prose: ProseSnapshot }>();
    proposeProseMock.mockReturnValue(pending.promise);

    renderStep({ prose: missing(), upToDate: false });

    await waitFor(() => expect(proposeProseMock).toHaveBeenCalledTimes(1));
  });

  it("PATH 3 missing + rejected, already attempted: NOTHING, until asked", async () => {
    renderStep({
      prose: missing({ rejected: { uzasadnienie: ["9 871,00"] } }),
      upToDate: false,
      attemptedSections: ["uzasadnienie"],
    });

    await waitFor(() =>
      expect(screen.getByLabelText(/Opis lokalu/)).toHaveValue("Tekst sekcji opis_lokalu."),
    );
    expect(proposeProseMock).not.toHaveBeenCalled();

    // …and the appraiser can still ask: the click carries `includeAttempted`,
    // which is what lifts the same bound on the server side (fix round 2).
    fireEvent.click(screen.getByRole("button", { name: "Wygeneruj ponownie" }));
    await waitFor(() =>
      expect(proposeProseMock).toHaveBeenCalledWith(VID, { includeAttempted: true }),
    );
  });

  it("PATH 3 control — missing + rejected but NOT yet attempted fires exactly once", async () => {
    const pending = deferred<{ prose: ProseSnapshot }>();
    proposeProseMock.mockReturnValue(pending.promise);

    renderStep({
      prose: missing({ rejected: { uzasadnienie: ["9 871,00"] } }),
      upToDate: false,
    });

    await waitFor(() => expect(proposeProseMock).toHaveBeenCalledTimes(1));
  });

  it("an attempt recorded against OLDER facts is no bound at all — the server drops it", async () => {
    // `attemptedSections` is computed against TODAY's fingerprint server-side
    // (`attemptedProseSections`), so a stale attempt simply never arrives here.
    // This pins the contract the component relies on: what it receives is
    // already "attempted at the CURRENT facts", never "attempted, once".
    const pending = deferred<{ prose: ProseSnapshot }>();
    proposeProseMock.mockReturnValue(pending.promise);

    renderStep({
      prose: missing({ rejected: { uzasadnienie: ["9 871,00"] } }),
      upToDate: false,
      attemptedSections: [],
    });

    await waitFor(() => expect(proposeProseMock).toHaveBeenCalledTimes(1));
  });

  it("a remount during 'wszystkie od nowa' joins it — it does not buy a second (fix round 1)", async () => {
    // Keying the in-flight map by BATCH made the two buttons invisible to each
    // other: the appraiser clicks "wszystkie od nowa", steps 6 -> 5 -> 6 during
    // the ~10 s call, and the returning mount — which still sees the server's
    // pre-run props and so wants to auto-fire — looked under the DEFAULT key,
    // found nothing, and bought a second generation.
    const pending = deferred<{ prose: ProseSnapshot }>();
    proposeProseMock.mockReturnValue(pending.promise);

    // Nothing to auto-fire on this mount: the click is the only call.
    const first = renderStep({ prose: allSixFresh(), upToDate: true });
    fireEvent.click(screen.getByRole("button", { name: "Wygeneruj wszystkie od nowa" }));
    await waitFor(() => expect(proposeProseMock).toHaveBeenCalledTimes(1));
    expect(proposeProseMock).toHaveBeenCalledWith(VID, { sections: [...PROSE_SECTIONS] });

    first.unmount();
    // The returning mount WOULD auto-fire — and must join instead.
    renderStep({ prose: missing(), upToDate: false, attemptedSections: [] });

    await screen.findByTestId("prose-generating");
    expect(proposeProseMock).toHaveBeenCalledTimes(1);
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
