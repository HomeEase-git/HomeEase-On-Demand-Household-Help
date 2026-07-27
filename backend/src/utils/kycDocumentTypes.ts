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
] as const;

export type KycDocumentTypeValue = (typeof KYC_DOCUMENT_TYPES)[number];
