export const KYC_DOCUMENT_TYPES = [
  'GOVERNMENT_ID_FRONT',
  'GOVERNMENT_ID_BACK',
  'SELFIE',
  'RESUME',
  'CERTIFICATION',
  'NBI_CLEARANCE',
  'BARANGAY_CLEARANCE',
  'POLICE_CLEARANCE',
  'CEDULA',
  // Not part of onboarding (uploaded any time post-onboarding via the tax-info
  // screen) — reuses this same upload endpoint/bucket rather than a
  // dedicated one. See workerController.submitVatRegistration.
  'VAT_REGISTRATION',
] as const;

export type KycDocumentTypeValue = (typeof KYC_DOCUMENT_TYPES)[number];
