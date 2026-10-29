import React, { useEffect } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import { EmptyState } from "../../../../components/feedback/EmptyState";
import NotificationDetail from "../../../../components/list-items/NotificationDetail";
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

  const isBookingRelated = category === "booking" && notification.relatedId;

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Notification" showBack />
      <NotificationDetail
        category={category}
        title={notification.title}
        message={notification.message}
        createdAt={notification.createdAt}
        actionLabel={isBookingRelated ? "View Job" : undefined}
        onAction={() =>
          router.push(`/(worker)/requests/${notification.relatedId}`)
        }
      />
    </SafeAreaView>
  );
}
