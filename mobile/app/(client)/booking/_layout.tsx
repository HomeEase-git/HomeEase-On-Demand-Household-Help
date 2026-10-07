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
      {/* Going back would land on an emptied Step 4 (the draft is cleared on submit). */}
      <Stack.Screen name="success" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
