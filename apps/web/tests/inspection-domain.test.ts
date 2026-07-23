import { describe, expect, it } from "vitest";
import type { Valuation } from "../src/ports/valuation";
import { approvableInput } from "./fixtures/valuation-inputs";
import { AUDIT_ACTIONS, InspectionLimitError, applyInspectionOp } from "../src/domain/valuation";
import {
  MAX_INSPECTION_PHOTOS,
  buildPhotoKey,
  isOwnPhotoKey,
  totalInspectionPhotos,
} from "../src/domain/inspection";

const VID = "11111111-2222-3333-4444-555555555555";
const draft = (): Valuation =>
  ({
    id: VID,
    status: "in_progress",
    ownerId: "owner-1",
    inputs: approvableInput("owner-1").inputs,
  }) as unknown as Valuation;

describe("applyInspectionOp", () => {
  it("add_photo appends the key to the right section, creating the snapshot lazily", () => {
    const key = buildPhotoKey("wnetrza", "u-1", VID);
    const v = applyInspectionOp(draft(), { kind: "add_photo", section: "wnetrza", key });
    expect(v.inputs!.inspection!.photos.wnetrza).toEqual([key]);
    expect(v.inputs!.inspection!.photos.otoczenie).toEqual([]);
    expect(v.inputs!.inspection!.note).toBeNull();
  });
  it("add_photo refuses a duplicate key and the 50-photo cap", () => {
    let v = draft();
    const key = buildPhotoKey("otoczenie", "u-dup", VID);
    v = applyInspectionOp(v, { kind: "add_photo", section: "otoczenie", key });
    expect(() => applyInspectionOp(v, { kind: "add_photo", section: "otoczenie", key })).toThrow();
    for (let i = 1; i < MAX_INSPECTION_PHOTOS; i++) {
      v = applyInspectionOp(v, {
        kind: "add_photo",
        section: "wnetrza",
        key: buildPhotoKey("wnetrza", `u-${i}`, VID),
      });
    }
    expect(totalInspectionPhotos(v.inputs!.inspection)).toBe(MAX_INSPECTION_PHOTOS);
    expect(() =>
      applyInspectionOp(v, {
        kind: "add_photo",
        section: "budynekZewn",
        key: buildPhotoKey("budynekZewn", "u-over", VID),
      }),
    ).toThrow(InspectionLimitError);
  });
  it("remove_photo drops the key; removing a missing key is a no-op", () => {
    const key = buildPhotoKey("budynekZewn", "u-2", VID);
    let v = applyInspectionOp(draft(), { kind: "add_photo", section: "budynekZewn", key });
    v = applyInspectionOp(v, { kind: "remove_photo", section: "budynekZewn", key });
    expect(v.inputs!.inspection!.photos.budynekZewn).toEqual([]);
    expect(() =>
      applyInspectionOp(v, { kind: "remove_photo", section: "budynekZewn", key: "nope" }),
    ).not.toThrow();
  });
  it("set_note trims and stores null for the empty string", () => {
    const v = applyInspectionOp(draft(), { kind: "set_note", note: "  Lokal po remoncie.  " });
    expect(v.inputs!.inspection!.note).toBe("Lokal po remoncie.");
    const cleared = applyInspectionOp(v, { kind: "set_note", note: "   " });
    expect(cleared.inputs!.inspection!.note).toBeNull();
  });
  it("refuses non-draft and missing inputs (F-7 siblings' contract)", () => {
    const signed = { ...draft(), status: "signed" } as Valuation;
    expect(() => applyInspectionOp(signed, { kind: "set_note", note: "x" })).toThrow(/not a draft/);
    const noInputs = { ...draft(), inputs: null } as Valuation;
    expect(() => applyInspectionOp(noInputs, { kind: "set_note", note: "x" })).toThrow(/no inputs/);
  });
});

describe("inspection keys + audit action", () => {
  it("buildPhotoKey/isOwnPhotoKey embed and detect the valuation id", () => {
    const key = buildPhotoKey("budynekZewn", "abc", VID);
    expect(key).toBe(`ogledziny-budynek-abc-${VID}.jpg`);
    expect(isOwnPhotoKey(key, VID)).toBe(true);
    expect(isOwnPhotoKey(key, "other-id")).toBe(false);
  });
  it("AUDIT_ACTIONS contains inspection_updated", () => {
    expect(AUDIT_ACTIONS).toContain("inspection_updated");
    // Slice 11a (wizard-domain.test.ts) added 4 more actions on top of these 9.
    expect(AUDIT_ACTIONS).toHaveLength(13);
  });
});
