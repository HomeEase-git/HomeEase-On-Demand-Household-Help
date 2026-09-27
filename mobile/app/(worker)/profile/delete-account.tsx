import React from "react";
import DeleteAccountScreen from "../../../components/account/DeleteAccountScreen";

export default function WorkerDeleteAccountScreen() {
  return <DeleteAccountScreen deactivatePath="/(worker)/profile/deactivate-account" />;
}
