import React from "react";
import { Stack } from "expo-router";
import { colors } from "../../../constants";

export const unstable_settings = {
  initialRouteName: "index",
};

export default function InboxLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.surface },
      }}
    />
  );
}
