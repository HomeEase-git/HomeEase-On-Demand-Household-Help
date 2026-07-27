import React from "react";
import { View, Text } from "react-native";

type Props = {
  count: number;
};

export const NotificationBadge: React.FC<Props> = ({ count }) => {
  if (count <= 0) return null;
  return (
    <View className="absolute -top-1 -right-1 min-w-[18] h-[18] rounded-full bg-error items-center justify-center px-1">
      <Text className="text-white text-xs font-bold">
        {count > 99 ? "99+" : count}
      </Text>
    </View>
  );
};

export default NotificationBadge;
