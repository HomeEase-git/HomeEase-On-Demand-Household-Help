import { Stack } from "expo-router";

export default function ExtendLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    />
  );
}
