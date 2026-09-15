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
 * The render would print an amount other than the one the valuation carries
 * (I-21). Raised only by {@link documentInputFor}; the actions turn it into a
 * refusal that names the two numbers, never into a document.
 */
export class AmountMismatchError extends Error {
  constructor(
    readonly stored: number,
    readonly rendered: number,
  ) {
    super(`Document would print ${rendered} for a valuation issued at ${stored}`);
    this.name = "AmountMismatchError";
  }
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
  // I-21: the document may not print an amount other than the one the valuation
  // carries. Being ABLE to compute a result is not the same as computing the
  // SAME result — a valuation approved under an earlier rule still holds the
  // amount it was issued with, while a render from its own snapshot can now
  // land elsewhere.
  //
  // NOTHING reaches this today: signing re-renders nothing (it signs the stored
  // DOCX, ADR-020), and approve and the preview only ever see drafts, whose
  // amount `readFeatureScale` has already dropped unless the snapshot still
  // produces it. This is a BARRIER FOR THE PATHS TO COME, not protection of a
  // live state — it costs two lines and stands at the one junction every render
  // is assembled through (R-2), so a fourth path, or a loosened status gate,
  // cannot quietly print a number the valuation does not carry.
  if (valuation.wr != null && render.kcs.wr !== valuation.wr) {
    throw new AmountMismatchError(valuation.wr, render.kcs.wr);
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
