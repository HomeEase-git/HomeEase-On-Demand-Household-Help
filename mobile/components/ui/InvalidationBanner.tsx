import React from "react";
import { View, Text, Pressable } from "react-native";
import { useBookingStore } from "../../store/bookingStore";
import { colors } from "../../constants";

export default function InvalidationBanner() {
  const reason = useBookingStore((s) => s.draft.lastInvalidationReason);
  const clear = useBookingStore((s) => s.clearInvalidationReason);

  if (!reason) return null;

  return (
    <View
      style={{
        backgroundColor: `${colors.warning}1A`,
        padding: 10,
        borderRadius: 8,
        marginVertical: 8,
      }}
    >
      <Text style={{ color: colors.warning }}>{reason}</Text>
      <Pressable onPress={() => clear()} style={{ marginTop: 8 }}>
        <Text style={{ color: colors.brand.DEFAULT }}>Dismiss</Text>
      </Pressable>
    </View>
  );
}
