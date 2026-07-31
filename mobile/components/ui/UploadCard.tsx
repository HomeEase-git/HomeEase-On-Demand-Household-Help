import React from "react";
import { View, Text, Pressable } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { colors } from "../../constants";

type Props = {
  label: string;
  onPress: () => void;
  preview?: string | null;
  subtitle?: string;
  required?: boolean;
  disabled?: boolean;
};

export const UploadCard: React.FC<Props> = ({
  label,
  onPress,
  preview,
  subtitle,
  required,
  disabled,
}) => {
  return (
    <Pressable
      className={`bg-card border border-dashed rounded-xl p-4 min-h-[120] ${disabled ? "opacity-60" : ""}`}
      style={{ borderColor: preview ? colors.success : colors.divider }}
      onPress={onPress}
      disabled={disabled}
    >
      <View className="flex-row items-start justify-between">
        <View className="flex-1">
          <View className="flex-row items-center mb-1">
            <Text className="text-brand text-sm font-semibold flex-1">
              {label}
            </Text>
            {required ? (
              <View className="ml-2 rounded-full bg-error/10 px-2 py-1">
                <Text className="text-error text-[10px] font-semibold">
                  Required
                </Text>
              </View>
            ) : (
              <View className="ml-2 rounded-full bg-accent/10 px-2 py-1">
                <Text className="text-accent text-[10px] font-semibold">
                  Optional
                </Text>
              </View>
            )}
          </View>
          {subtitle ? (
            <Text className="text-text-secondary text-xs mt-1">{subtitle}</Text>
          ) : null}
        </View>
        {!preview ? (
          <Ionicons
            name="cloud-upload-outline"
            size={24}
            color={colors.text.muted}
          />
        ) : (
          <Ionicons name="checkmark-circle" size={24} color={colors.success} />
        )}
      </View>

      {preview ? (
        <Text className="text-brand text-sm mt-3" numberOfLines={2}>
          {preview}
        </Text>
      ) : null}
    </Pressable>
  );
};

export default UploadCard;
