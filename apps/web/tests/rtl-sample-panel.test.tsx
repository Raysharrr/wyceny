// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { SamplePanel } from "@/app/valuations/[id]/steps/sample-panel";
import type { Candidate } from "@/domain/sample-selection";

afterEach(cleanup);
const c: Candidate = {
  transactionId: "T1",
  date: "2026-06-12",
  area: 50.1,
  pricePerM2: 12480,
  priceTotal: 625248,
  egib: {
    teryt: "306401_1",
    obreb: "0039",
    arkusz: "22",
    dzialka: "13/82",
    budynek: "1",
    lokal: "43",
  },
  lokalId: "306401_1.0039.AR_22.13/82.1_BUD.43_LOK",
  distanceM: 0,
  floor: 3,
  rooms: 2,
  market: "wtorny",
  share: "1/1",
  transType: "wolnyRynek",
  function: "mieszkalna",
  seller: "osobaFizyczna",
  pos: { x: 355285, y: 505324 },
};
const entry = {
  panoId: "P1",
  captureDate: "2023-07",
  thumbnailKey: "streetview/x.jpg",
  heading: 90,
  lat: 52.39,
  lng: 16.87,
};
const base = {
  candidate: c,
  index: 0,
  total: 38,
  entry,
  embedKey: "K",
  streetViewEnabled: true,
  isProposed: true,
  onKeep: vi.fn(),
  onReject: vi.fn(),
  onClose: vi.fn(),
};

describe("SamplePanel", () => {
  it("shows the street view iframe with capture caption, all record fields, and the mode switch", async () => {
    render(<SamplePanel {...base} />);
    expect(screen.getByText("Kandydatka 1 z 38")).toBeInTheDocument();
    const frame = screen.getByTitle("Street View");
    expect(frame).toHaveAttribute("src", expect.stringContaining("/maps/embed/v1/streetview"));
    expect(screen.getByText(/zdjęcie Google z 2023-07/)).toBeInTheDocument();
    expect(screen.getByText("625 248,00 zł")).toBeInTheDocument();
    expect(screen.getByText("0039 Łazarz")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ortofoto" }));
    expect(screen.getByRole("img", { name: /Ortofotomapa/ })).toHaveAttribute(
      "src",
      expect.stringContaining("PZGIK/ORTO"),
    );
    await userEvent.click(screen.getByRole("button", { name: "Mapa" }));
    expect(screen.getByTitle("Mapa")).toHaveAttribute(
      "src",
      expect.stringContaining("/maps/embed/v1/view"),
    );
  });
  it("Rynek field maps the raw RCN value to a Polish label (final wave minor i)", () => {
    const { rerender } = render(<SamplePanel {...base} candidate={{ ...c, market: "wtorny" }} />);
    expect(screen.getByText("wtórny")).toBeInTheDocument();
    rerender(<SamplePanel {...base} candidate={{ ...c, market: "pierwotny" }} />);
    expect(screen.getByText("pierwotny")).toBeInTheDocument();
    rerender(<SamplePanel {...base} candidate={{ ...c, market: null }} />);
    expect(screen.getByText("nieznany")).toBeInTheDocument();
  });
  it("no panorama → Ulica disabled, no iframe ever, caption visible in every mode, starts in Ortofoto; Mapa stays enabled (works by location)", async () => {
    render(
      <SamplePanel
        {...base}
        entry={{ ...entry, panoId: null, captureDate: null, thumbnailKey: null, heading: null }}
      />,
    );
    expect(screen.getByRole("button", { name: "Ulica" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Mapa" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Ortofoto" })).toHaveAttribute(
      "data-variant",
      "default",
    );
    expect(screen.queryByTitle("Street View")).toBeNull();
    expect(screen.getByRole("img", { name: /Ortofotomapa/ })).toBeInTheDocument();
    expect(screen.getByText(/brak zdjęcia ulicy/)).toBeInTheDocument();
    // Still visible after switching tabs — unlike the "has a panorama"
    // caption (scoped to mode "street"), this one explains why the panel
    // opened on Ortofoto in the first place and holds in every mode.
    await userEvent.click(screen.getByRole("button", { name: "Mapa" }));
    expect(screen.getByText(/brak zdjęcia ulicy/)).toBeInTheDocument();
  });
  it("no embed key or feature off → placeholder text instead of iframe; ortofoto still works", () => {
    render(<SamplePanel {...base} embedKey={null} />);
    expect(screen.queryByTitle("Street View")).toBeNull();
    expect(screen.getByText(/Podgląd Street View jest wyłączony/)).toBeInTheDocument();
  });
  it("NO entry at all (enrichment skipped/failed) → 'brak miniaturki', same wording as the table; Ulica still disabled, starts in Ortofoto (M6, final wave addendum)", () => {
    render(<SamplePanel {...base} entry={undefined} />);
    expect(screen.getByRole("button", { name: "Ulica" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ortofoto" })).toHaveAttribute(
      "data-variant",
      "default",
    );
    expect(screen.getByText("brak miniaturki")).toBeInTheDocument();
    expect(screen.queryByText(/brak zdjęcia ulicy/)).toBeNull();
  });
  it("Enter in the rejection note never submits the surrounding step form (I2, final wave addendum) — and triggers the reject when a reason is already selected", async () => {
    const onReject = vi.fn();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <SamplePanel {...base} onReject={onReject} />
        <button type="submit">Zapisz</button>
      </form>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Odrzuć" }));
    const note = screen.getByPlaceholderText("notatka (opcjonalnie)");
    note.focus();
    // No reason picked yet — Enter must neither submit the form nor reject blind.
    await userEvent.keyboard("{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();

    await userEvent.click(screen.getByLabelText("budynek starszy"));
    note.focus();
    await userEvent.type(note, "test note");
    await userEvent.keyboard("{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalledWith({ reason: "building_older", note: "test note" });
  });
  it("Enter on the CHECKED reason radio confirms the rejection, never submits the surrounding form (wave 3C)", async () => {
    const onReject = vi.fn();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <SamplePanel {...base} onReject={onReject} />
        <button type="submit">Zapisz</button>
      </form>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Odrzuć" }));
    const radio = screen.getByLabelText("budynek starszy");
    await userEvent.click(radio);
    radio.focus();
    await userEvent.keyboard("{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledWith({ reason: "building_older" });
  });
  it("Zostaw → onKeep; Odrzuć → reasons, confirm requires a reason, emits reason + note", async () => {
    const onReject = vi.fn();
    const onKeep = vi.fn();
    render(<SamplePanel {...base} onReject={onReject} onKeep={onKeep} />);
    await userEvent.click(screen.getByRole("button", { name: "Zostaw" }));
    expect(onKeep).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Odrzuć" }));
    const confirm = screen.getByRole("button", { name: "Potwierdź odrzucenie" });
    expect(confirm).toBeDisabled();
    await userEvent.click(screen.getByLabelText("budynek starszy"));
    await userEvent.type(screen.getByPlaceholderText("notatka (opcjonalnie)"), "kamienica 1905");
    await userEvent.click(confirm);
    expect(onReject).toHaveBeenCalledWith({ reason: "building_older", note: "kamienica 1905" });
  });
  it("Enter anywhere in the panel = Zostaw (next); Escape = close", async () => {
    const onKeep = vi.fn();
    const onClose = vi.fn();
    render(<SamplePanel {...base} onKeep={onKeep} onClose={onClose} />);
    screen.getByRole("button", { name: "Zostaw" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(onKeep).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
  it("no embed key → Ulica and Mapa are disabled, Ortofoto is the active tab", () => {
    render(<SamplePanel {...base} embedKey={null} />);
    expect(screen.getByRole("button", { name: "Ulica" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Mapa" })).toBeDisabled();
    const orto = screen.getByRole("button", { name: "Ortofoto" });
    expect(orto).not.toBeDisabled();
    expect(orto).toHaveAttribute("data-variant", "default");
  });
  it("ortofoto onError falls back to KIEG once; a second error leaves the src unchanged", async () => {
    render(<SamplePanel {...base} />);
    await userEvent.click(screen.getByRole("button", { name: "Ortofoto" }));
    const img = screen.getByRole("img", { name: /Ortofotomapa/ });
    fireEvent.error(img);
    const srcAfterFirst = img.getAttribute("src");
    expect(srcAfterFirst).toContain("KrajowaIntegracjaEwidencjiGruntow");
    fireEvent.error(img);
    expect(img.getAttribute("src")).toBe(srcAfterFirst);
  });
  it("ortofoto's one-shot fallback remounts per candidate — candidate B's own ORTO failure still triggers its own KIEG fallback", async () => {
    const entryNoPano = {
      ...entry,
      panoId: null,
      captureDate: null,
      thumbnailKey: null,
      heading: null,
    };
    const { rerender } = render(<SamplePanel {...base} entry={entryNoPano} />);
    const imgA = screen.getByRole("img", { name: /Ortofotomapa/ });
    fireEvent.error(imgA);
    const srcAAfterFallback = imgA.getAttribute("src");
    expect(srcAAfterFallback).toContain("KrajowaIntegracjaEwidencjiGruntow");

    // Candidate B has a different `pos` so its ORTO/KIEG URLs are
    // distinguishable from A's; also no panorama, so mode stays "orto"
    // across the switch — exactly the scenario where a reused DOM node
    // (no key) would carry A's stale `data-fallback` marker over to B.
    const candidateB = { ...c, transactionId: "T2", pos: { x: 355400, y: 505500 } };
    rerender(<SamplePanel {...base} candidate={candidateB} entry={entryNoPano} />);
    const imgB = screen.getByRole("img", { name: /Ortofotomapa/ });
    expect(imgB.getAttribute("src")).toContain("PZGIK/ORTO");
    expect(imgB.getAttribute("src")).not.toBe(srcAAfterFallback);

    fireEvent.error(imgB);
    expect(imgB.getAttribute("src")).toContain("KrajowaIntegracjaEwidencjiGruntow");
    expect(imgB.getAttribute("src")).not.toBe(srcAAfterFallback);
  });
  it("switching to a different candidate (different transactionId) resets rejecting/reason/note", async () => {
    const { rerender } = render(<SamplePanel {...base} />);
    await userEvent.click(screen.getByRole("button", { name: "Odrzuć" }));
    await userEvent.click(screen.getByLabelText("budynek starszy"));
    await userEvent.type(screen.getByPlaceholderText("notatka (opcjonalnie)"), "kamienica 1905");
    expect(screen.getByRole("button", { name: "Potwierdź odrzucenie" })).not.toBeDisabled();

    const candidateB = { ...c, transactionId: "T2" };
    rerender(<SamplePanel {...base} candidate={candidateB} />);

    // rejecting block closed
    expect(screen.queryByRole("button", { name: "Potwierdź odrzucenie" })).toBeNull();
    expect(screen.getByRole("button", { name: "Odrzuć" })).toBeInTheDocument();

    // reopening shows a FRESH block: no radio checked, note empty, confirm disabled
    await userEvent.click(screen.getByRole("button", { name: "Odrzuć" }));
    expect(screen.getByRole("button", { name: "Potwierdź odrzucenie" })).toBeDisabled();
    expect(screen.getByLabelText("budynek starszy")).not.toBeChecked();
    expect(screen.getByPlaceholderText("notatka (opcjonalnie)")).toHaveValue("");
  });
  it("switching to a candidate whose entry has no panorama resets the active tab to Ortofoto", () => {
    const { rerender } = render(<SamplePanel {...base} />);
    expect(screen.getByTitle("Street View")).toBeInTheDocument();

    const candidateB = { ...c, transactionId: "T2" };
    rerender(
      <SamplePanel
        {...base}
        candidate={candidateB}
        entry={{ ...entry, panoId: null, captureDate: null, thumbnailKey: null, heading: null }}
      />,
    );
    expect(screen.queryByTitle("Street View")).toBeNull();
    expect(screen.getByRole("img", { name: /Ortofotomapa/ })).toBeInTheDocument();
  });
});
