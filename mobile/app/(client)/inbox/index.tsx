import React, { useEffect, useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ConversationItem from "../../../components/list-items/ConversationItem";
import NotificationItem from "../../../components/list-items/NotificationItem";
import EmptyState from "../../../components/feedback/EmptyState";
import { useNotificationStore, notificationCategory } from "../../../store/notificationStore";
import { useMessageStore } from "../../../store/messageStore";
import { formatDate } from "../../../utils/formatDate";
import * as api from "../../../services/api";

export default function InboxScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<"messages" | "notifications">("messages");
  const [loading, setLoading] = useState(true);
  const notifications = useNotificationStore((s) => s.notifications);
  const notificationsLoading = useNotificationStore((s) => s.loading);
  const fetchNotifications = useNotificationStore((s) => s.fetchNotifications);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const conversations = useMessageStore((s) => s.conversations);
  const setConversations = useMessageStore((s) => s.setConversations);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      try {
        const result = await api.getConversations();
        if (!active) return;
        setConversations(result);
      } catch (error) {
        console.error("Load conversations error:", error);
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [setConversations]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="px-4 pt-4 pb-2">
        <Text className="text-text-primary text-2xl font-bold">Inbox</Text>
        <View className="flex-row mt-3 gap-2">
          <Pressable
            className={`px-4 py-2 rounded-xl ${
              tab === "messages" ? "bg-accent" : "bg-card"
            }`}
            onPress={() => setTab("messages")}
          >
            <Text
              className={
                tab === "messages"
                  ? "text-white font-semibold"
                  : "text-text-secondary"
              }
            >
              Messages
            </Text>
          </Pressable>
          <Pressable
            className={`px-4 py-2 rounded-xl ${
              tab === "notifications" ? "bg-accent" : "bg-card"
            }`}
            onPress={() => setTab("notifications")}
          >
            <Text
              className={
                tab === "notifications"
                  ? "text-white font-semibold"
                  : "text-text-secondary"
              }
            >
              Notifications
            </Text>
          </Pressable>
        </View>
        {tab === "notifications" && (
          <Pressable className="self-end mt-2" onPress={markAllRead}>
            <Text className="text-accent text-sm">Mark all as read</Text>
          </Pressable>
        )}
      </View>
      {tab === "messages" ? (
        loading ? (
          <View className="py-6 items-center">
            <ActivityIndicator size="small" />
          </View>
        ) : conversations.length > 0 ? (
          <FlatList
            data={[...conversations].sort((a, b) =>
              (b.lastMessageTime ?? "").localeCompare(a.lastMessageTime ?? ""),
            )}
            keyExtractor={(item) => item.userId}
            contentContainerStyle={{ padding: 16 }}
            renderItem={({ item }) => (
              <ConversationItem
                conversation={{
                  id: item.userId,
                  name: item.name,
                  lastMessage: item.lastMessage,
                  time: item.lastMessageTime,
                  unread: item.unread,
                }}
                onPress={() =>
                  router.push(`/(client)/inbox/chat/${item.userId}`)
                }
              />
            )}
          />
        ) : (
          <EmptyState
            title="No conversations yet"
            subtitle="Start a new chat from your bookings or worker profiles."
          />
        )
      ) : notificationsLoading ? (
        <View className="py-6 items-center">
          <ActivityIndicator size="small" />
        </View>
      ) : notifications.length > 0 ? (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <NotificationItem
              notification={{
                id: item.id,
                title: item.title,
                body: item.message,
                time: formatDate(item.createdAt, "MMM D, h:mm A"),
                type: notificationCategory(item.type),
                isRead: item.isRead,
              }}
              onPress={() =>
                router.push(`/(client)/inbox/notification/${item.id}`)
              }
            />
          )}
        />
      ) : (
        <EmptyState
          title="No notifications yet"
          subtitle="You'll see booking, payment, and message updates here."
        />
      )}
    </SafeAreaView>
  );
}
