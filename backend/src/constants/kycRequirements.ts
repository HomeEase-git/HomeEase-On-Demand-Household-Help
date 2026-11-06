import type { KycDocumentType } from '@prisma/client';

export const TIER_1_REQUIRED_DOCUMENT_TYPES = [
  'GOVERNMENT_ID_FRONT',
  'GOVERNMENT_ID_BACK',
  'SELFIE',
  'NBI_CLEARANCE',
  'RESUME',
  'HEALTH_CERTIFICATE',
] as const satisfies readonly KycDocumentType[];

export const CLEARANCE_VALIDITY_DAYS: Partial<Record<KycDocumentType, number>> = {
  // NBI clearance is valid 1 year from issue.
  NBI_CLEARANCE: 365,
  POLICE_CLEARANCE: 180,
  BARANGAY_CLEARANCE: 365,
  CEDULA: 365,
  HEALTH_CERTIFICATE: 365,
};
