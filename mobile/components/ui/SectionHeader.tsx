import React from "react";
import { View, Text, Pressable } from "react-native";

type Props = {
  title: string;
  actionLabel?: string;
  onActionPress?: () => void;
  rightElement?: React.ReactNode;
};

export const SectionHeader: React.FC<Props> = ({
  title,
  actionLabel,
  onActionPress,
  rightElement,
}) => {
  return (
    <View className="flex-row items-center justify-between mb-3">
      <Text className="text-text-primary font-bold text-base flex-1">{title}</Text>
      <View className="flex-row items-center gap-3">
        {actionLabel && onActionPress && (
          <Pressable onPress={onActionPress}>
            <Text className="text-accent text-sm font-semibold">
              {actionLabel}
            </Text>
          </Pressable>
        )}
        {rightElement}
      </View>
    </View>
  );
};

export default SectionHeader;
