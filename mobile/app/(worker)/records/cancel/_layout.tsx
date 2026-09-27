import { Stack } from "expo-router";

export default function CancelLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    />
  );
}
