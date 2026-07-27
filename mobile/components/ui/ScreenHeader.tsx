import React from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors } from "../../constants";
type Props = {
  title: string;
  showBack?: boolean;
  rightIcon?: keyof typeof Ionicons.glyphMap;
  onRightPress?: () => void;
};

export const ScreenHeader: React.FC<Props> = ({
  title,
  showBack = true,
  rightIcon,
  onRightPress,
}) => {
  const router = useRouter();

  return (
    <View className="bg-white pt-4 pb-3 px-4 flex-row items-center">
      {showBack ? (
        <Pressable
          className="w-10 h-10 rounded-full items-center justify-center mr-2"
          onPress={() => router.back()}
        >
          <Ionicons name="chevron-back" size={22} color={colors.text.primary} />
        </Pressable>
      ) : (
        <View className="w-10 mr-2" />
      )}
      <Text className="flex-1 text-text-primary font-bold text-lg text-center">
        {title}
      </Text>
      {rightIcon ? (
        <Pressable
          className="w-10 h-10 rounded-full items-center justify-center ml-2"
          onPress={onRightPress}
        >
          <Ionicons name={rightIcon} size={22} color={colors.text.primary} />
        </Pressable>
      ) : (
        <View className="w-10 ml-2" />
      )}
    </View>
  );
};

export default ScreenHeader;
