// Versions of the legal documents shown in the app. Sent with every
// acceptance (POST /users/me/contract-acceptance) so the backend records
// exactly which text a user agreed to. Bump a version whenever that
// document's wording changes materially.
export const LEGAL_VERSIONS = {
  CLIENT_USER_AGREEMENT: "2026-09-25",
  WORKER_SERVICE_AGREEMENT: "2026-09-25",
  PRIVACY_NOTICE: "2026-09-25",
  KYC_CONSENT: "2026-09-25",
} as const;

export type LegalDocumentType = keyof typeof LEGAL_VERSIONS;
