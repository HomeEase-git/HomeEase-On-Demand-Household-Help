import React from "react";
import { useLocalSearchParams } from "expo-router";
import RescheduleRequestForm from "../../../../components/booking/RescheduleRequestForm";

/**
 * Worker proposes a new date/time for an accepted job — e.g. two of their
 * jobs overlap. The client accepts or declines; if they decline, the worker
 * must show up at the original time or take the no-show penalty.
 */
export default function WorkerRequestRescheduleScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  return <RescheduleRequestForm bookingId={jobId} as="worker" />;
}
