import React from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link } from "expo-router";
import EmptyState from "../components/feedback/EmptyState";

export default function NotFoundScreen() {
  return (
    <SafeAreaView className="flex-1 bg-white">
      <EmptyState
        icon="compass-outline"
        title="Page not found"
        subtitle="The screen you're looking for doesn't exist or may have moved."
      />
      <Link href="/" className="text-accent font-semibold text-center mb-8">
        Go back home
      </Link>
    </SafeAreaView>
  );
}
