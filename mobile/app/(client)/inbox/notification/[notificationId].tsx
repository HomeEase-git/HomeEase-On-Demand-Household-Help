import React, { useEffect } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import { EmptyState } from "../../../../components/feedback/EmptyState";
import NotificationDetail from "../../../../components/list-items/NotificationDetail";
import { useNotificationStore, notificationCategory } from "../../../../store/notificationStore";

export default function NotificationDetailScreen() {
  const router = useRouter();
  const { notificationId } = useLocalSearchParams<{ notificationId: string }>();
  const notifications = useNotificationStore((s) => s.notifications);
  const fetchNotifications = useNotificationStore((s) => s.fetchNotifications);
  const markAsRead = useNotificationStore((s) => s.markAsRead);
  const notification = notifications.find((n) => n.id === notificationId);

  useEffect(() => {
    if (notifications.length === 0) fetchNotifications();
  }, [notifications.length, fetchNotifications]);

  useEffect(() => {
    if (notificationId) markAsRead(notificationId);
  }, [notificationId, markAsRead]);

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

  // Payment notifications (reminders, receipts) also point at a booking.
  const isBookingRelated = (category === "booking" || category === "payment") && notification.relatedId;

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Notification" showBack />
      <NotificationDetail
        category={category}
        title={notification.title}
        message={notification.message}
        createdAt={notification.createdAt}
        actionLabel={isBookingRelated ? "View Booking" : undefined}
        onAction={() =>
          router.push(`/(client)/booking/${notification.relatedId}`)
        }
      />
    </SafeAreaView>
  );
}
