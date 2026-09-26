import React from "react";
import { LegalDocumentScreen } from "../../../components/legal/LegalDocumentView";
import { WORKER_AGREEMENT } from "../../../constants/legalDocuments";

export default function WorkerTermsScreen() {
  return <LegalDocumentScreen document={WORKER_AGREEMENT} />;
}
