// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
// Registers `toBeInTheDocument` etc. on vitest's `expect` — no test in this
// repo has needed jest-dom's matchers before, so there's no shared setup
// file wiring it in; import it directly here rather than touching the
// fleet-wide vitest.config.ts.
import "@testing-library/jest-dom/vitest";
import { SignatureForm } from "@/app/profile/signature-form";

afterEach(cleanup);
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const saveSignature = vi.hoisted(() => vi.fn());
vi.mock("@/app/actions/save-signature", () => ({ saveSignature }));

describe("SignatureForm", () => {
  it("submits the chosen file and surfaces the action error", async () => {
    saveSignature.mockResolvedValueOnce({ error: "Dozwolone formaty: PNG lub JPEG." });
    render(<SignatureForm hasSignature={false} />);
    const input = screen.getByLabelText(/skan podpisu/i);
    await userEvent.upload(input, new File(["x"], "sig.gif", { type: "image/gif" }));
    await userEvent.click(screen.getByRole("button", { name: /zapisz podpis/i }));
    await waitFor(() => expect(saveSignature).toHaveBeenCalledOnce());
    expect(await screen.findByText(/dozwolone formaty/i)).toBeInTheDocument();
  });

  it("tells a first-time user there is no scan yet", () => {
    render(<SignatureForm hasSignature={false} />);
    expect(screen.getByText(/nie wgrano jeszcze skanu podpisu/i)).toBeInTheDocument();
  });
});
