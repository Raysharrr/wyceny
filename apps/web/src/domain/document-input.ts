import type { BuildDocumentInput, OperatAuthor, OperatPurpose } from "./document-model";
import type { KcsResult } from "./kcs";
import type { AppraiserProfile } from "../ports/profile";
import type { Valuation } from "../ports/valuation";

/**
 * `appraiser_profile` → the author block the document prints (ADR-020 cz. 1).
 * Nulls become empty strings rather than being rejected: an incomplete profile
 * is a PREVIEW state (the appraiser has not filled it in yet), and B-15 is
 * what refuses the issue — this function has no business throwing on it.
 *
 * `policyPages` stays empty here; see {@link OperatAuthor}.
 */
export function authorFrom(profile: AppraiserProfile | null): OperatAuthor {
  return {
    fullName: profile?.fullName ?? "",
    licenseNo: profile?.licenseNo ?? "",
    officeBlock: profile?.officeBlock ?? "",
    policyPages: [],
  };
}

/**
 * The operat's `BuildDocumentInput` for a valuation (R-2) — the ONE place it
 * is assembled, for approve, sign and the step-7 preview alike. A field
 * spelled out in each action separately could reach the approved document and
 * not the signed one, whose text then differs from what was approved.
 *
 * Only the values that belong to a particular render come from the caller:
 * `approvedAt` (the issue date for approve/sign, today for the preview),
 * `kcs`/`amountInWords` (computed there because the words need the worker),
 * and `author` — the profile read of whoever is logged in, which no pure
 * function can perform (F-10).
 *
 * Whether the render is a preview is `buildDocumentModel`'s own option, not
 * part of the input.
 */
export function documentInputFor(
  valuation: Valuation,
  render: { approvedAt: Date; kcs: KcsResult; amountInWords: string; author: OperatAuthor },
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
    author: render.author,
  };
}
