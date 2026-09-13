// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ComparablesProvenance } from "@/app/valuations/[id]/cards";
import type { KcsInput } from "@/domain/kcs";
import type { Candidate } from "@/domain/sample-selection";

afterEach(cleanup);

const candidate = (transactionId: string, pricePerM2: number) =>
  ({ transactionId, lokalId: "", date: "2026-01-01", area: 50, pricePerM2 }) as Candidate;

it("a register row whose price was edited by hand no longer reads as confirmed register data", () => {
  const row = (id: string, pricePerM2: number) => ({
    date: "2026-01-01",
    area: 50,
    pricePerM2,
    source: "rejestr_sm" as const,
    status: "confirmed" as const,
    transactionId: id,
    lokalId: "",
    coopTxId: id,
  });
  const inputs = {
    area: 50,
    features: [],
    comparables: [row("sm-1", 10000), row("sm-2", 9000)],
    sampleSelection: {
      proposed: [candidate("sm-1", 10000), candidate("sm-2", 10000)],
      alternates: [],
    },
  } as unknown as KcsInput;
  render(<ComparablesProvenance inputs={inputs} />);
  expect(screen.getAllByText("Rejestr SM — potwierdzone")).toHaveLength(1);
  expect(screen.getByText("Rzeczoznawca")).toBeTruthy();
});
