import React from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../constants";

type Props = {
  message: string | null;
  onDismiss?: () => void;
};

/**
 * ErrorBanner
 *
 * Displays an inline error message below form inputs or above
 * action buttons. Pass the error string from useLoadingError.
 *
 * Usage:
 *   <ErrorBanner message={error} onDismiss={clearError} />
 */
export const ErrorBanner: React.FC<Props> = ({ message, onDismiss }) => {
  if (!message) return null;

  return (
    <View className="bg-error/10 border border-error/30 rounded-xl p-3 flex-row items-start mb-4">
      <Ionicons
        name="alert-circle-outline"
        size={18}
        color={colors.error}
        style={{ marginTop: 1 }}
      />
      <Text className="text-error text-sm flex-1 ml-2">{message}</Text>
      {onDismiss && (
        <Pressable onPress={onDismiss} className="ml-2 p-0.5">
          <Ionicons name="close" size={16} color={colors.error} />
        </Pressable>
      )}
    </View>
  );
};

export default ErrorBanner;
