import React from "react";
import { useLocalSearchParams } from "expo-router";
import RescheduleRequestForm from "../../../../components/booking/RescheduleRequestForm";

/** Client proposes a new date/time for an accepted booking; the pro accepts or declines. */
export default function RequestRescheduleScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  return <RescheduleRequestForm bookingId={bookingId} as="client" />;
}
