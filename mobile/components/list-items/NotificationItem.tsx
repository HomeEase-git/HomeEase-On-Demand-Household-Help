import React from "react";
import { View, Text, Pressable } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { colors } from "../../constants";

type Notification = {
  id: string;
  title: string;
  body: string;
  time: string;
  type: string;
  isRead: boolean;
};

type Props = {
  notification: Notification;
  onPress: () => void;
};

export const NotificationItem: React.FC<Props> = ({
  notification,
  onPress,
}) => {
  const iconColor =
    notification.type === "booking"
      ? colors.brand.DEFAULT
      : notification.type === "payment"
        ? colors.success
        : colors.warning;

  return (
    <Pressable
      className={`flex-row items-start py-4 border-b border-divider px-3 rounded-xl mb-2 ${
        !notification.isRead ? "bg-card-light" : ""
      }`}
      onPress={onPress}
    >
      <View
        className="w-10 h-10 rounded-full items-center justify-center mr-3"
        style={{ backgroundColor: `${iconColor}20` }}
      >
        <Ionicons
          name={
            notification.type === "payment"
              ? "wallet-outline"
              : notification.type === "booking"
                ? "calendar-outline"
                : "chatbubble-outline"
          }
          size={20}
          color={iconColor}
        />
      </View>
      <View className="flex-1">
        <Text className="text-text-primary font-bold">{notification.title}</Text>
        <Text className="text-text-secondary text-sm" numberOfLines={2}>
          {notification.body}
        </Text>
        <Text className="text-text-muted text-xs mt-1">
          {notification.time}
        </Text>
      </View>
      {!notification.isRead && (
        <View className="w-2 h-2 rounded-full bg-accent mt-2 ml-2" />
      )}
    </Pressable>
  );
};

export default NotificationItem;
