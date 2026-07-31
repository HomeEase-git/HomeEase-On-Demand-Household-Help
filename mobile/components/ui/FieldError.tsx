import React from "react";
import { View, Text } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { colors } from "../../constants";

type Props = {
  message?: string | null;
};

/**
 * FieldError
 *
 * Inline validation message shown directly below a form field
 * (e.g. "Invalid email", "Incorrect password"). For page-level or
 * request-level errors, use ErrorBanner instead.
 *
 * Usage:
 *   <InputField ... error={emailError} />   // preferred, built in
 *   <FieldError message={emailError} />     // manual placement
 */
export const FieldError: React.FC<Props> = ({ message }) => {
  if (!message) return null;

  return (
    <View className="flex-row items-center gap-1 mt-1 mb-2">
      <Ionicons name="alert-circle" size={14} color={colors.error} />
      <Text className="text-error text-xs flex-1">{message}</Text>
    </View>
  );
};

export default FieldError;
