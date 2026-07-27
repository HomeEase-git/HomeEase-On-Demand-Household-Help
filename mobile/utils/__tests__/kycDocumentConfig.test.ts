import {
  getDocumentRequirement,
  getMissingRequiredDocuments,
  isDocumentTypeAllowed,
} from "../kycDocumentConfig";

describe("kyc document configuration", () => {
  it("marks identity and clearance documents as required", () => {
    expect(getDocumentRequirement("governmentIdFront").required).toBe(true);
    expect(getDocumentRequirement("nbiClearance").required).toBe(true);
    expect(getDocumentRequirement("barangayClearance").required).toBe(true);
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
      barangayClearance: { uri: "file://barangay.pdf" },
      resume: { uri: null },
    });

    expect(missing).toEqual(["governmentIdBack", "resume"]);
  });
});
