// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

afterEach(cleanup);

const OWNER = { id: "u1" };
vi.mock("@/auth/session", () => ({ getSession: async () => ({ user: OWNER }) }));
vi.mock("@/app/valuations/_deps", () => ({
  valuationRepository: {
    get: async () => ({
      id: "00000000-0000-4000-8000-000000000001",
      ownerId: OWNER.id,
      status: "in_progress",
      wr: null,
      address: "ul. Testowa 1",
      area: 50,
      propertyRight: "odrebna_wlasnosc",
      inputs: null,
    }),
  },
}));
vi.mock("@/components/wizard/wizard-shell", () => ({
  WizardShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/app/valuations/[id]/steps/method-selection", () => ({
  MethodSelection: () => <section data-testid="method-card" />,
}));
vi.mock("@/app/valuations/[id]/steps/step-sample", () => ({
  StepSample: () => <section data-testid="sample-step" />,
}));

it("step 3 spaces the method card from the sample cards like the rest of the wizard", async () => {
  const { default: Page } = await import("@/app/valuations/[id]/page");
  render(
    await Page({
      params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }),
      searchParams: Promise.resolve({ step: "3" }),
    }),
  );
  const wrapper = screen.getByTestId("method-card").parentElement!;
  expect(wrapper).toBe(screen.getByTestId("sample-step").parentElement);
  expect(wrapper.className).toContain("gap-4");
});
