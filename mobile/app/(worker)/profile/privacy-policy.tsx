import React from "react";
import { LegalDocumentScreen } from "../../../components/legal/LegalDocumentView";
import { PRIVACY_POLICY } from "../../../constants/legalDocuments";

export default function WorkerPrivacyPolicyScreen() {
  return <LegalDocumentScreen document={PRIVACY_POLICY} />;
}
