import React from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../constants";

type Props = {
  icon?: keyof typeof Ionicons.glyphMap;
  illustration?: React.ReactNode;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export const EmptyState: React.FC<Props> = ({
  icon = "information-circle-outline",
  illustration,
  title,
  subtitle,
  actionLabel,
  onAction,
}) => {
  return (
    <View className="flex-1 items-center justify-center py-16 px-6">
      <View className="mb-4">
        {illustration ?? (
          <View className="w-20 h-20 rounded-full bg-accent/10 items-center justify-center">
            <Ionicons name={icon} size={32} color={colors.accent.DEFAULT} />
          </View>
        )}
      </View>
      <Text className="text-text-primary font-semibold text-base text-center">
        {title}
      </Text>
      {subtitle && (
        <Text className="text-text-secondary text-sm text-center mt-1 max-w-xs">
          {subtitle}
        </Text>
      )}
      {actionLabel && onAction && (
        <Pressable
          className="flex-row items-center justify-center bg-accent rounded-full px-5 py-3 mt-5 self-center"
          style={{
            shadowColor: colors.accent.DEFAULT,
            shadowOffset: { width: 0, height: 3 },
            shadowOpacity: 0.3,
            shadowRadius: 8,
            elevation: 5,
          }}
          onPress={onAction}
        >
          <Text className="text-white font-semibold text-center">{actionLabel}</Text>
          <Ionicons name="arrow-forward" size={14} color={colors.white} style={{ marginLeft: 6 }} />
        </Pressable>
      )}
    </View>
  );
};

export default EmptyState;
