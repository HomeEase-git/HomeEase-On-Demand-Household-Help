import React, { useState, useRef, useEffect } from "react";
import { View, Text, FlatList, TextInput, Pressable, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import { useRouter, useLocalSearchParams } from "expo-router";
import ChatBubbleSent from "../../../../components/chat/ChatBubbleSent";
import ChatBubbleReceived from "../../../../components/chat/ChatBubbleReceived";
import Avatar from "../../../../components/ui/Avatar";
import ImageSourcePickerBottomSheet from "../../../../components/bottom-sheets/ImageSourcePickerBottomSheet";
import type { BottomSheetHandle } from "../../../../components/bottom-sheets/BottomSheetWrapper";
import { useMessageStore } from "../../../../store/messageStore";
import { useAuthStore } from "../../../../store/authStore";
import { colors } from "../../../../constants";
import * as api from "../../../../services/api";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function WorkerChatScreen() {
  const router = useRouter();
  const { id: userId } = useLocalSearchParams<{ id: string }>();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const imageSheetRef = useRef<BottomSheetHandle | null>(null);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const alertModal = useAlertModal();

  const messages = useMessageStore((s) =>
    userId ? (s.messagesByUser[userId] ?? []) : [],
  );
  const conversation = useMessageStore((s) =>
    s.conversations.find((c) => c.userId === userId),
  );
  const setMessages = useMessageStore((s) => s.setMessages);
  const appendMessage = useMessageStore((s) => s.appendMessage);
  const markConversationRead = useMessageStore((s) => s.markConversationRead);

  useEffect(() => {
    if (!userId) return;
    let active = true;

    api
      .getConversationThread(userId)
      .then((thread) => {
        if (active) setMessages(userId, thread);
      })
      .catch((error) => console.error("Load conversation thread error:", error));

    return () => {
      active = false;
    };
  }, [userId, setMessages]);

  // Reactively mark the thread read whenever it changes (initial load or a
  // live message pushed in over the socket while this screen is open).
  useEffect(() => {
    if (!userId) return;
    const hasUnreadIncoming = messages.some(
      (m) => m.receiverId === currentUserId && m.isRead === false,
    );
    if (!hasUnreadIncoming) return;

    api
      .markMessagesAsRead(userId)
      .then(() => markConversationRead(userId))
      .catch((error) => console.error("Mark messages read error:", error));
  }, [userId, messages, currentUserId, markConversationRead]);

  const send = async () => {
    if (!input.trim() || !userId || sending) return;
    const text = input.trim();
    setInput("");
    setSending(true);
    try {
      const message = await api.sendMessage(userId, text);
      appendMessage(userId, message);
    } catch (error) {
      console.error("Send message error:", error);
      setInput(text);
      alertModal.error("Error", "Failed to send message. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const sendImage = async (uri: string) => {
    if (!userId) return;
    try {
      const { url } = await api.uploadChatImage(uri);
      const message = await api.sendMessage(userId, "", url);
      appendMessage(userId, message);
    } catch (error) {
      console.error("Send image error:", error);
      alertModal.error("Error", "Failed to send image. Please try again.");
    }
  };

  const call = () => {
    if (!conversation?.phone) {
      alertModal.info("No phone number", "This contact has no phone number on file.");
      return;
    }
    Linking.openURL(`tel:${conversation.phone}`).catch(() =>
      alertModal.error("Error", "Could not open the phone dialer."),
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top"]}>
      <View className="flex-row items-center px-4 py-3 border-b border-divider">
        <Pressable onPress={() => router.back()} className="mr-2">
          <Ionicons name="chevron-back" size={24} color={colors.text.primary} />
        </Pressable>
        <Pressable className="mr-3" onPress={() => {}}>
          <Avatar uri={conversation?.avatar} size="sm" />
        </Pressable>
        <View className="flex-1">
          <Text className="text-text-primary font-bold">
            {conversation?.name ?? "Chat"}
          </Text>
        </View>
        <Pressable onPress={call}>
          <Ionicons name="call-outline" size={22} color={colors.text.primary} />
        </Pressable>
      </View>

      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
        renderItem={({ item }) =>
          item.senderId === currentUserId ? (
            <ChatBubbleSent
              message={item.content}
              imageUrl={item.imageUrl}
              timestamp={formatTime(item.createdAt)}
            />
          ) : (
            <ChatBubbleReceived
              message={item.content}
              imageUrl={item.imageUrl}
              timestamp={formatTime(item.createdAt)}
            />
          )
        }
      />

      <View className="flex-row items-center p-3 border-t border-divider">
        <Pressable
          className="p-2 mr-2"
          onPress={() => imageSheetRef.current?.expand()}
        >
          <Ionicons name="attach-outline" size={24} color={colors.text.muted} />
        </Pressable>
        <TextInput
          className="flex-1 bg-card rounded-full px-4 py-2 text-primary max-h-24"
          placeholder="Message..."
          placeholderTextColor={colors.text.muted}
          value={input}
          onChangeText={setInput}
          multiline
        />
        <Pressable
          className={`bg-accent rounded-full p-2 ml-2 ${sending ? "opacity-50" : ""}`}
          onPress={send}
          disabled={sending}
        >
          <Ionicons name="send" size={20} color={colors.white} />
        </Pressable>
      </View>
      <ImageSourcePickerBottomSheet
        innerRef={imageSheetRef}
        onSelect={sendImage}
      />
    </SafeAreaView>
  );
}
