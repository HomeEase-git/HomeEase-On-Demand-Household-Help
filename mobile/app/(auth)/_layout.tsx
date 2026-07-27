import React from "react";
import { Stack } from "expo-router";
import { colors } from "../../constants";

export default function AuthLayout() {
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
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" />
      <Stack.Screen name="forgot-password" />
      <Stack.Screen name="password-reset-sent" />
      <Stack.Screen name="reset-password" />
      <Stack.Screen name="otp-verification" />
      <Stack.Screen name="account-created-success" />
      <Stack.Screen name="terms-conditions" />
      <Stack.Screen name="verify-email" />
    </Stack>
  );
}
