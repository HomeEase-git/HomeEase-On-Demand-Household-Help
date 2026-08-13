import React, { useEffect } from "react";
import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import { EmptyState } from "../../../../components/feedback/EmptyState";
import { colors } from "../../../../constants";
import { formatDate } from "../../../../utils/formatDate";
import { useNotificationStore, notificationCategory } from "../../../../store/notificationStore";

export default function WorkerNotificationDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const notifications = useNotificationStore((s) => s.notifications);
  const fetchNotifications = useNotificationStore((s) => s.fetchNotifications);
  const markAsRead = useNotificationStore((s) => s.markAsRead);
  const notification = notifications.find((n) => n.id === id);

  useEffect(() => {
    if (notifications.length === 0) fetchNotifications();
  }, [notifications.length, fetchNotifications]);

  useEffect(() => {
    if (id) markAsRead(id);
  }, [id, markAsRead]);

  if (!notification) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Notification" showBack />
        <EmptyState
          icon="notifications-outline"
          title="Notification not found"
          subtitle="This notification may have been removed."
        />
      </SafeAreaView>
    );
  }

  const category = notificationCategory(notification.type);
  const iconColor =
    category === "booking"
      ? colors.brand.DEFAULT
      : category === "payment"
        ? colors.success
        : colors.warning;

  const isBookingRelated = category === "booking" && notification.relatedId;

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Notification" showBack />
      <View className="px-4 py-6">
        <View
          className="w-16 h-16 rounded-full items-center justify-center mb-4"
          style={{ backgroundColor: `${iconColor}20` }}
        >
          <Ionicons name="notifications" size={32} color={iconColor} />
        </View>
        <Text className="text-text-primary text-xl font-bold">
          {notification.title}
        </Text>
        <Text className="text-text-muted text-sm mt-1">
          {formatDate(notification.createdAt, "MMM D, YYYY h:mm A")}
        </Text>
        <Text className="text-text-secondary mt-4">{notification.message}</Text>
        {isBookingRelated && (
          <View className="mt-8">
            <PrimaryButton
              label="View Job"
              fullWidth
              onPress={() =>
                router.push(`/(worker)/requests/${notification.relatedId}`)
              }
            />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
