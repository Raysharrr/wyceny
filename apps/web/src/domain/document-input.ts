import type { BuildDocumentInput, OperatPurpose } from "./document-model";
import type { KcsResult } from "./kcs";
import type { Valuation } from "../ports/valuation";

/**
 * The operat's `BuildDocumentInput` for a valuation (R-2) — the ONE place it
 * is assembled, for approve, sign and the step-7 preview alike. A field
 * spelled out in each action separately could reach the approved document and
 * not the signed one, whose text then differs from what was approved.
 *
 * Only the values that belong to a particular render come from the caller:
 * `approvedAt` (the issue date for approve/sign, today for the preview), and
 * `kcs`/`amountInWords` (computed there because the words need the worker).
 * Whether the render is a preview is `buildDocumentModel`'s own option, not
 * part of the input.
 */
export function documentInputFor(
  valuation: Valuation,
  render: { approvedAt: Date; kcs: KcsResult; amountInWords: string },
): BuildDocumentInput {
  if (!valuation.inputs) {
    throw new Error(`Valuation ${valuation.id} has no inputs snapshot — no document to build`);
  }
  return {
    address: valuation.address,
    area: valuation.area,
    purpose: valuation.purpose as OperatPurpose,
    kwNumber: valuation.kwNumber,
    propertyRight: valuation.propertyRight,
    client: valuation.client ?? "",
    inspectionDate: valuation.inspectionDate ?? "",
    approvedAt: render.approvedAt,
    inputs: valuation.inputs,
    kcs: render.kcs,
    amountInWords: render.amountInWords,
  };
}
