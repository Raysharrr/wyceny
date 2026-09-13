// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
const { selectMethodAction, refresh } = vi.hoisted(() => ({
  selectMethodAction: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/app/actions/select-method", () => ({ selectMethodAction }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
import { MethodSelection } from "@/app/valuations/[id]/steps/method-selection";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("explicit method choice", () => {
  it("does not select or confirm automatically, submits only after deliberate confirmation", async () => {
    const user = userEvent.setup();
    selectMethodAction.mockResolvedValue({ ok: true });
    render(<MethodSelection valuationId="v" comparableCount={12} />);
    expect(screen.getByLabelText("Wybierz metodę wyceny")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Potwierdź metodę" })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("Wybierz metodę wyceny"), "kcs");
    expect(selectMethodAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Potwierdź metodę" }));
    expect(selectMethodAction).toHaveBeenCalledWith("v", { method: "kcs", confirm: true });
    expect(refresh).toHaveBeenCalled();
  });
  it("shows persisted confirmation and requires another act to change method", async () => {
    const user = userEvent.setup();
    selectMethodAction.mockResolvedValue({ error: "Zapis odrzucony" });
    render(<MethodSelection valuationId="v" method="kcs" methodConfirmed comparableCount={12} />);
    expect(screen.getByRole("status")).toHaveTextContent("Potwierdzona metoda: KCS.");
    await user.selectOptions(screen.getByLabelText("Wybierz metodę wyceny"), "pp");
    expect(screen.getByRole("status")).toHaveTextContent("Metoda wymaga potwierdzenia.");
    await user.click(screen.getByRole("button", { name: "Potwierdź metodę" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Zapis odrzucony");
    expect(refresh).not.toHaveBeenCalled();
  });
});
