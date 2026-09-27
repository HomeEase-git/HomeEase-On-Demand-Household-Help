import type { KycDocumentType } from '@prisma/client';

// Tier 1 minimum documents (see documents.MD) required before a worker's
// initial onboarding verification can be approved (adminVerificationController)
// or even enter the review queue (userController.acceptContract) without an
// explicit admin override.
export const TIER_1_REQUIRED_DOCUMENT_TYPES = [
  'GOVERNMENT_ID_FRONT',
  'GOVERNMENT_ID_BACK',
  'SELFIE',
  'NBI_CLEARANCE',
  // Business decision (2026-09-25): every worker submits a resume. It's
  // reviewed by the admin and parsed into the worker's public skills — it is
  // NOT sent to the AI identity check (see verificationAiService).
  'RESUME',
] as const satisfies readonly KycDocumentType[];

// Government-issued clearances that actually expire in real life, vs. an ID
// photo or selfie which doesn't. Read by adminVerificationController.
// approveDocument (to auto-compute KycDocument.expiresAt on approval) and
// bookingWorker.flagExpiredKycDocuments (the re-verification sweep).
export const CLEARANCE_VALIDITY_DAYS: Partial<Record<KycDocumentType, number>> = {
  // NBI clearance is valid 1 year from issue.
  NBI_CLEARANCE: 365,
  // Police clearance is conventionally valid 6 months from issue.
  POLICE_CLEARANCE: 180,
  // Barangay clearance is conventionally valid 1 year from issue.
  BARANGAY_CLEARANCE: 365,
  // Cedula (community tax certificate) is valid for the calendar year it's
  // issued in; 1 year from issue is a reasonable approximation without
  // requiring calendar-aware logic here.
  CEDULA: 365,
};
