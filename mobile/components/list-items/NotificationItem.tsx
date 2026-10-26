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

export const CATEGORY: Record<
  string,
  {
    icon: React.ComponentProps<typeof Ionicons>["name"];
    color: string;
    label: string;
  }
> = {
  booking: { icon: "calendar-outline", color: colors.brand.DEFAULT, label: "Booking" },
  payment: { icon: "wallet-outline", color: colors.success, label: "Payment" },
  review: { icon: "star-outline", color: colors.warning, label: "Review" },
  message: { icon: "chatbubble-outline", color: colors.brand.DEFAULT, label: "Message" },
  system: { icon: "notifications-outline", color: colors.warning, label: "Update" },
};

export const NotificationItem: React.FC<Props> = ({
  notification,
  onPress,
}) => {
  const { icon, color } = CATEGORY[notification.type] ?? CATEGORY.system;
  const unread = !notification.isRead;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${unread ? "Unread. " : ""}${notification.title}. ${notification.body}. ${notification.time}`}
      className={`flex-row items-start p-3 rounded-2xl mb-2 border active:opacity-70 ${
        unread ? "bg-card-light border-accent/30" : "bg-card border-divider"
      }`}
      onPress={onPress}
    >
      <View
        className="w-11 h-11 rounded-full items-center justify-center mr-3"
        style={{ backgroundColor: `${color}20` }}
      >
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <View className="flex-1">
        <View className="flex-row items-start justify-between">
          <Text
            className={`flex-1 text-text-primary ${unread ? "font-bold" : "font-medium"}`}
            numberOfLines={1}
          >
            {notification.title}
          </Text>
          <Text className="text-text-muted text-xs ml-2 mt-0.5">
            {notification.time}
          </Text>
        </View>
        <Text
          className={`text-sm mt-0.5 ${unread ? "text-text-primary" : "text-text-secondary"}`}
          numberOfLines={2}
        >
          {notification.body}
        </Text>
      </View>
      {unread && <View className="w-2.5 h-2.5 rounded-full bg-accent mt-1.5 ml-2" />}
    </Pressable>
  );
};

export default NotificationItem;
