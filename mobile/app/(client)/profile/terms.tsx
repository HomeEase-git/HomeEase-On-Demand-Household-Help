import React from "react";
import { LegalDocumentScreen } from "../../../components/legal/LegalDocumentView";
import { CLIENT_TERMS } from "../../../constants/legalDocuments";

export default function TermsScreen() {
  return <LegalDocumentScreen document={CLIENT_TERMS} />;
}
