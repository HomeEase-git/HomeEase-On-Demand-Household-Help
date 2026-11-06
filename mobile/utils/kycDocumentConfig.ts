export type KycDocumentKey =
  | "governmentIdFront"
  | "governmentIdBack"
  | "selfie"
  | "nbiClearance"
  | "barangayClearance"
  | "policeClearance"
  | "cedula"
  | "resume"
  | "healthCertificate"
  | "certification";

export type DocumentRequirement = {
  label: string;
  required: boolean;
  accepts: string[];
  description: string;
};

export const documentRequirements: Record<KycDocumentKey, DocumentRequirement> = {
  governmentIdFront: {
    label: "Government ID (Front)",
    required: true,
    accepts: ["image/jpeg", "image/jpg", "image/png"],
    description: "Upload a clear image of the front of your government-issued ID.",
  },
  governmentIdBack: {
    label: "Government ID (Back)",
    required: true,
    accepts: ["image/jpeg", "image/jpg", "image/png"],
    description: "Upload a clear image of the back of your government-issued ID.",
  },
  selfie: {
    label: "Selfie",
    required: true,
    accepts: ["image/jpeg", "image/jpg", "image/png"],
    description: "Take a selfie to help confirm your identity.",
  },
  nbiClearance: {
    label: "NBI Clearance",
    required: true,
    accepts: ["application/pdf", "image/jpeg", "image/jpg", "image/png"],
    description: "Upload a PDF or photo of your NBI clearance.",
  },
  barangayClearance: {
    label: "Barangay Clearance",
    required: false,
    accepts: ["application/pdf", "image/jpeg", "image/jpg", "image/png"],
    description: "Optional. Upload a PDF or photo of your barangay clearance.",
  },
  policeClearance: {
    label: "Police Clearance",
    required: false,
    accepts: ["application/pdf", "image/jpeg", "image/jpg", "image/png"],
    description: "Optional for higher trust verification.",
  },
  cedula: {
    label: "Cedula",
    required: false,
    accepts: ["application/pdf", "image/jpeg", "image/jpg", "image/png"],
    description: "Optional community tax certificate.",
  },
  resume: {
    label: "Resume",
    required: true,
    accepts: ["application/pdf"],
    description: "Upload your resume as a PDF file.",
  },
  healthCertificate: {
    label: "Health Certificate",
    required: true,
    accepts: ["application/pdf", "image/jpeg", "image/jpg", "image/png"],
    description: "A medical certificate saying you're fit to work, from a clinic or health center. Renewed every year.",
  },
  certification: {
    label: "Certification",
    required: false,
    accepts: ["application/pdf", "image/jpeg", "image/jpg", "image/png"],
    description: "Optional professional certification, added when registering for a service.",
  },
};

export function getDocumentRequirement(documentKey: KycDocumentKey): DocumentRequirement {
  return documentRequirements[documentKey];
}

export function isDocumentTypeAllowed(documentKey: KycDocumentKey, mimeType?: string | null) {
  if (!mimeType) return false;
  const normalized = mimeType.toLowerCase();
  return documentRequirements[documentKey].accepts.some((accepted) => normalized.includes(accepted.replace("image/jpg", "image/jpeg")));
}

export function getMissingRequiredDocuments(documents: Partial<Record<KycDocumentKey, { uri?: string | null }>>) {
  return (Object.keys(documentRequirements) as KycDocumentKey[])
    .filter((key) => documentRequirements[key].required)
    .filter((key) => !documents[key]?.uri);
}
