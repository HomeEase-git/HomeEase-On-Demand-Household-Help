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
