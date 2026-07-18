// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input } from "@/components/ui/input";

/**
 * RTL infra smoke (Slice 6 Task 1): proves jsdom + RTL + user-event work
 * under vitest in CI. Three Slice-5 bugs (coerce-trap, checkbox data-state,
 * empty-subject) hid exactly in the no-component-test gap this closes.
 */
describe("RTL infra", () => {
  it("renders a ui Input and accepts typed text", async () => {
    render(<Input aria-label="proba" />);
    const input = screen.getByLabelText("proba");
    await userEvent.type(input, "69,56");
    expect(input).toHaveProperty("value", "69,56");
  });
});
