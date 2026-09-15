/** Appraiser profile port (PRD "dane do podpisu") — pure interface, F-10. */

/**
 * The appraiser's professional identity as the operat carries it (ADR-020
 * cz. 1). Every field is nullable because a row created before `0017` — or by
 * a signature upload alone — has none of them; completeness is the approval
 * gate's business (B-15/B-16), not this type's.
 */
export type AppraiserProfile = {
  fullName: string | null;
  licenseNo: string | null;
  /** Office address block, as typed — multi-line, printed verbatim. */
  officeBlock: string | null;
  /** Storage PREFIX of the policy pages (`<key>/page-001.jpg`, …), one JPEG per page. */
  insuranceDocKey: string | null;
  /** `YYYY-MM-DD`, compared against the operat's date — never a timestamp (B-16). */
  insuranceValidUntil: string | null;
};

export interface PortProfile {
  /** Null when the appraiser has no profile row at all. */
  get(userId: string): Promise<AppraiserProfile | null>;
  /** Upserts the author fields ONLY — never touches the signature or the policy. */
  saveAuthor(
    userId: string,
    author: { fullName: string; licenseNo: string; officeBlock: string },
  ): Promise<void>;
  /** Upserts the policy fields ONLY — never touches the signature or the author. */
  saveInsurance(userId: string, insurance: { docKey: string; validUntil: string }): Promise<void>;
  /**
   * Null when no scan was uploaded — which, since `0017` made the columns
   * nullable, includes a row that exists only to carry the author data.
   */
  getSignature(userId: string): Promise<{ bytes: Buffer; mime: string } | null>;
  /** Upserts — a re-uploaded scan replaces the previous one (profile data is
   * mutable; only rendered documents are frozen). */
  saveSignature(userId: string, bytes: Buffer, mime: string): Promise<void>;
}
