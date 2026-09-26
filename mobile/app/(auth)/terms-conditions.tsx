import React from "react";
import { useLocalSearchParams } from "expo-router";
import { LegalDocumentScreen } from "../../components/legal/LegalDocumentView";
import { CLIENT_TERMS, WORKER_AGREEMENT } from "../../constants/legalDocuments";

// Linked from sign-up (before login). Shows the agreement for the role
// being signed up for — the same text accepted later in the app.
export default function TermsConditionsScreen() {
  const { role } = useLocalSearchParams<{ role?: string }>();
  return <LegalDocumentScreen document={role === "worker" ? WORKER_AGREEMENT : CLIENT_TERMS} />;
}
