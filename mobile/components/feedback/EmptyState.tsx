import React from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../constants";

type Props = {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export const EmptyState: React.FC<Props> = ({
  icon = "information-circle-outline",
  title,
  subtitle,
  actionLabel,
  onAction,
}) => {
  return (
    <View className="flex-1 items-center justify-center py-16 px-6">
      {/* TODO: Replace with contextual empty state illustration */}
      <View className="w-20 h-20 rounded-full bg-card items-center justify-center mb-4">
        <Ionicons name={icon} size={32} color={colors.text.muted} />
      </View>
      <Text className="text-text-primary font-semibold text-base text-center">
        {title}
      </Text>
      {subtitle && (
        <Text className="text-text-secondary text-sm text-center mt-1">
          {subtitle}
        </Text>
      )}
      {actionLabel && onAction && (
        <Pressable className="mt-4" onPress={onAction}>
          <Text className="text-accent font-semibold">{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
};

export default EmptyState;
