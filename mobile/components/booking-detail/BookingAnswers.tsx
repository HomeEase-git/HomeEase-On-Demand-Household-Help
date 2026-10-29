import React from "react";
import { View, Text } from "react-native";
import { formatQuantity } from "../../utils/pricing";

/**
 * What the client booked beyond the service name: how many units (per-unit
 * jobs) and their optional note. Bookings made before booking questions were
 * retired also list their answers (Booking.scopeAnswers). Renders nothing
 * when there's none of these.
 */
export const BookingAnswers: React.FC<{
  quantity?: number | null;
  unit?: string | null;
  answers?: Record<string, string | string[]> | null;
  note?: string | null;
}> = ({ quantity, unit, answers, note }) => {
  const rows = Object.entries(answers ?? {})
    .map(([label, value]) => [label, Array.isArray(value) ? value.join(", ") : String(value ?? "")] as const)
    .filter(([, value]) => value.trim() !== "");
  if (quantity != null) rows.unshift(["How many", formatQuantity(quantity, unit)]);
  const trimmedNote = note?.trim();
  if (!rows.length && !trimmedNote) return null;

  return (
    <View className="mt-3 pt-3 border-t border-divider">
      {rows.map(([label, value]) => (
        <View key={label} className="flex-row justify-between py-1">
          <Text className="text-text-muted text-sm flex-1 pr-3">{label}</Text>
          <Text className="text-text-primary text-sm font-semibold flex-1 text-right">{value}</Text>
        </View>
      ))}
      {!!trimmedNote && (
        <View className="py-1">
          <Text className="text-text-muted text-sm">Note</Text>
          <Text className="text-text-primary text-sm mt-0.5">{trimmedNote}</Text>
        </View>
      )}
    </View>
  );
};

export default BookingAnswers;
