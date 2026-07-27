import React from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../constants";
type Props = {
  isVerified: boolean;
  onVerifyPress?: () => void;
};

export const VerificationBanner: React.FC<Props> = ({
  isVerified,
  onVerifyPress,
}) => {
  if (isVerified) {
    return (
      <View className="bg-success/10 border border-success rounded-xl p-3 flex-row items-center">
        <Ionicons name="checkmark-circle" size={24} color={colors.success} />
        <Text className="text-success font-semibold ml-2">
          Identity Verified
        </Text>
      </View>
    );
  }
  return (
    <View className="bg-warning/10 border border-warning rounded-xl p-3 flex-row items-center justify-between">
      <View className="flex-row items-center">
        <Ionicons name="warning" size={24} color={colors.warning} />
        <Text className="text-warning font-semibold ml-2">
          Verify your identity
        </Text>
      </View>
      <Pressable onPress={onVerifyPress}>
        <Text className="text-accent font-semibold">Verify Now</Text>
      </Pressable>
    </View>
  );
};

export default VerificationBanner;
