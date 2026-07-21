import React from "react";
import { View, Text, Pressable } from "react-native";
import { useBookingStore } from "../../store/bookingStore";

export default function InvalidationBanner() {
  const reason = useBookingStore((s) => s.draft.lastInvalidationReason);
  const clear = useBookingStore((s) => s.clearInvalidationReason);

  if (!reason) return null;

  return (
    <View
      style={{
        backgroundColor: "#FFF4E5",
        padding: 10,
        borderRadius: 8,
        marginVertical: 8,
      }}
    >
      <Text style={{ color: "#663C00" }}>{reason}</Text>
      <Pressable onPress={() => clear()} style={{ marginTop: 8 }}>
        <Text style={{ color: "#1F6FEB" }}>Dismiss</Text>
      </Pressable>
    </View>
  );
}
