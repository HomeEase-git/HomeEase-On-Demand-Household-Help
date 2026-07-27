import React from "react";
import { Stack } from "expo-router";
import { colors } from "../../constants";

export default function OnboardingLayout() {
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
    />
  );
}
