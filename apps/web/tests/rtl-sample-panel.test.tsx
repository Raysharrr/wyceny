// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
  it("no panorama → no iframe, 'brak zdjęcia ulicy', starts in Ortofoto", () => {
    render(
      <SamplePanel
        {...base}
        entry={{ ...entry, panoId: null, captureDate: null, thumbnailKey: null, heading: null }}
      />,
    );
    expect(screen.queryByTitle("Street View")).toBeNull();
    expect(screen.getByText(/brak zdjęcia ulicy/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Ortofotomapa/ })).toBeInTheDocument();
  });
  it("no embed key or feature off → placeholder text instead of iframe; ortofoto still works", () => {
    render(<SamplePanel {...base} embedKey={null} />);
    expect(screen.queryByTitle("Street View")).toBeNull();
    expect(screen.getByText(/Podgląd Street View jest wyłączony/)).toBeInTheDocument();
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
    expect(onKeep).toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
