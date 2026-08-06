import React from "react";
import { Stack } from "expo-router";
import { colors } from "../../constants";

export default function KycLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "slide_from_right",
        animationDuration: 250,
        contentStyle: { backgroundColor: colors.surface },
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text.primary,
        headerShadowVisible: false,
      }}
    >
      {/* Waiting screen for unverified workers — no swipe-back, since it
          must not offer any way out until an admin makes a decision. */}
      <Stack.Screen name="pending" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
