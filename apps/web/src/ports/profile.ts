/** Appraiser profile port (PRD "dane do podpisu") — pure interface, F-10. */
export interface PortProfile {
  getSignature(userId: string): Promise<{ bytes: Buffer; mime: string } | null>;
  /** Upserts — a re-uploaded scan replaces the previous one (profile data is
   * mutable; only rendered documents are frozen). */
  saveSignature(userId: string, bytes: Buffer, mime: string): Promise<void>;
}
