import React from "react";
import { Stack } from "expo-router";
import { colors } from "../../../constants";

export const unstable_settings = {
  initialRouteName: "index",
};

export default function BookingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.surface },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="success" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
