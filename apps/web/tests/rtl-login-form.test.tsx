// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { LoginForm } from "@/app/(auth)/login/login-form";

// `actions.ts` is a "use server" module that pulls in Better Auth + pg;
// the form only needs *a* callable action to render.
vi.mock("@/app/(auth)/login/actions", () => ({ signInAction: vi.fn() }));

afterEach(cleanup);

describe("LoginForm", () => {
  it("offers only the e-mail + password form — no one-click demo login", () => {
    const { container } = render(<LoginForm />);

    // A re-added demo card would add a second (and third) button here.
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName("Zaloguj się");
    expect(container.innerHTML).not.toMatch(/zaloguj jako/i);
    expect(container.innerHTML).not.toMatch(/konta demonstracyjne/i);
  });

  it("leaks no seeded account address into the rendered markup", () => {
    const { container } = render(<LoginForm />);

    // Covers hidden inputs too — a demo button hid the credentials in
    // `<input type="hidden">`, which no text query would have caught.
    expect(container.innerHTML).not.toMatch(/@wyceny\.test/i);
  });

  it("still renders the credential inputs it is supposed to", () => {
    render(<LoginForm />);

    expect(screen.getByLabelText("Adres e-mail")).toBeInTheDocument();
    expect(screen.getByLabelText("Hasło")).toBeInTheDocument();
  });
});
