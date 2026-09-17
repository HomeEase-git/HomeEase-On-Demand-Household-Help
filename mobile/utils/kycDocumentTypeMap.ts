import type { KycDocumentKey } from './kycDocumentConfig';

export const kycDocumentTypeMap: Record<KycDocumentKey, string> = {
  governmentIdFront: 'GOVERNMENT_ID_FRONT',
  governmentIdBack: 'GOVERNMENT_ID_BACK',
  selfie: 'SELFIE',
  resume: 'RESUME',
  certification: 'CERTIFICATION',
  nbiClearance: 'NBI_CLEARANCE',
  barangayClearance: 'BARANGAY_CLEARANCE',
  policeClearance: 'POLICE_CLEARANCE',
  cedula: 'CEDULA',
};

export function mapKycDocumentType(documentKey: KycDocumentKey): string {
  return kycDocumentTypeMap[documentKey];
}

// Reverse of kycDocumentTypeMap, plus the two backend document types that
// have no onboarding-wizard key (VAT_REGISTRATION is submitted later from
// the tax-info screen, CERTIFICATION already has one above) — used by the
// "My Documents" screen to label a raw KycDocument row for display.
export const kycDocumentTypeLabel: Record<string, string> = {
  GOVERNMENT_ID_FRONT: 'Government ID (Front)',
  GOVERNMENT_ID_BACK: 'Government ID (Back)',
  SELFIE: 'Selfie',
  RESUME: 'Resume',
  CERTIFICATION: 'Certification',
  NBI_CLEARANCE: 'NBI Clearance',
  BARANGAY_CLEARANCE: 'Barangay Clearance',
  POLICE_CLEARANCE: 'Police Clearance',
  CEDULA: 'Cedula',
  VAT_REGISTRATION: 'VAT Registration',
};

export function labelForKycDocumentType(documentType: string): string {
  return kycDocumentTypeLabel[documentType] ?? documentType;
}
