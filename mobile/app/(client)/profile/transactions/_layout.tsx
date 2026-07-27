import React from "react";
import { Stack } from "expo-router";
import { colors } from "../../../../constants";

export default function TransactionsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.surface },
      }}
    />
  );
}
