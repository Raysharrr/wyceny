// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { SampleRadius } from "@/app/valuations/[id]/steps/sample-radius";

afterEach(cleanup);

describe("SampleRadius", () => {
  it("marks the active radius aria-pressed=true, others false", () => {
    render(
      <SampleRadius
        value={1000}
        steps={[500, 1000, 2000, 3000]}
        busy={false}
        disabledReason={null}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "1000 m" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "500 m" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "2000 m" })).toHaveAttribute("aria-pressed", "false");
  });

  it("clicking a different radius calls onChange with that value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SampleRadius
        value={500}
        steps={[500, 1000, 2000, 3000]}
        busy={false}
        disabledReason={null}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "2000 m" }));
    expect(onChange).toHaveBeenCalledWith(2000);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("clicking the already-active radius does not call onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SampleRadius
        value={500}
        steps={[500, 1000, 2000, 3000]}
        busy={false}
        disabledReason={null}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "500 m" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("busy disables all buttons", () => {
    render(
      <SampleRadius
        value={500}
        steps={[500, 1000, 2000, 3000]}
        busy
        disabledReason={null}
        onChange={vi.fn()}
      />,
    );
    for (const r of [500, 1000, 2000, 3000]) {
      expect(screen.getByRole("button", { name: `${r} m` })).toBeDisabled();
    }
  });

  it("a disabledReason disables all buttons and exposes the reason via title (not as a second visible copy — the caller's alert is the single visible one, review round 1 minor #3)", () => {
    const reason = "Zmiana promienia wymaga świeżej puli — pobierz próbę z RCN ponownie.";
    render(
      <SampleRadius
        value={500}
        steps={[500, 1000, 2000, 3000]}
        busy={false}
        disabledReason={reason}
        onChange={vi.fn()}
      />,
    );
    for (const r of [500, 1000, 2000, 3000]) {
      const btn = screen.getByRole("button", { name: `${r} m` });
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute("title", reason);
    }
    // No second, always-visible copy of the message next to the buttons.
    expect(screen.queryByText(reason)).toBeNull();
  });
});
