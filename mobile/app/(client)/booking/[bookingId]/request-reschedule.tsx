import React from "react";
import { useLocalSearchParams } from "expo-router";
import RescheduleRequestForm from "../../../../components/booking/RescheduleRequestForm";

export default function RequestRescheduleScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  return <RescheduleRequestForm bookingId={bookingId} as="client" />;
}
