import React from "react";
import { useLocalSearchParams } from "expo-router";
import RescheduleRequestForm from "../../../../components/booking/RescheduleRequestForm";

export default function WorkerRequestRescheduleScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  return <RescheduleRequestForm bookingId={jobId} as="worker" />;
}
