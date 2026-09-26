import React from "react";
import { LegalDocumentScreen } from "../../../components/legal/LegalDocumentView";
import { PRIVACY_POLICY } from "../../../constants/legalDocuments";

export default function PrivacyPolicyScreen() {
  return <LegalDocumentScreen document={PRIVACY_POLICY} />;
}
