import {
  getDocumentRequirement,
  getMissingRequiredDocuments,
  isDocumentTypeAllowed,
} from "../kycDocumentConfig";

describe("kyc document configuration", () => {
  // Must match backend TIER_1_REQUIRED_DOCUMENT_TYPES.
  it("requires ID, selfie, NBI clearance and resume; other clearances are optional", () => {
    expect(getDocumentRequirement("governmentIdFront").required).toBe(true);
    expect(getDocumentRequirement("governmentIdBack").required).toBe(true);
    expect(getDocumentRequirement("selfie").required).toBe(true);
    expect(getDocumentRequirement("nbiClearance").required).toBe(true);
    expect(getDocumentRequirement("resume").required).toBe(true);
    expect(getDocumentRequirement("barangayClearance").required).toBe(false);
    expect(getDocumentRequirement("policeClearance").required).toBe(false);
    expect(getDocumentRequirement("cedula").required).toBe(false);
  });

  it("restricts image-only documents to image files", () => {
    expect(isDocumentTypeAllowed("governmentIdFront", "image/png")).toBe(true);
    expect(isDocumentTypeAllowed("governmentIdFront", "application/pdf")).toBe(false);
    expect(isDocumentTypeAllowed("selfie", "image/jpeg")).toBe(true);
  });

  it("allows pdf or image files for clearance documents", () => {
    expect(isDocumentTypeAllowed("nbiClearance", "application/pdf")).toBe(true);
    expect(isDocumentTypeAllowed("nbiClearance", "image/png")).toBe(true);
    expect(isDocumentTypeAllowed("nbiClearance", "text/plain")).toBe(false);
  });

  it("reports missing required documents", () => {
    const missing = getMissingRequiredDocuments({
      governmentIdFront: { uri: "file://front.jpg" },
      governmentIdBack: { uri: null },
      selfie: { uri: "file://selfie.jpg" },
      nbiClearance: { uri: "file://nbi.pdf" },
      barangayClearance: { uri: null },
      resume: { uri: null },
    });

    expect(missing).toEqual(["governmentIdBack", "resume"]);
  });
});
