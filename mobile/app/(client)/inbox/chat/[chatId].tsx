import React, { useState, useRef, useEffect, useCallback } from "react";
import { View, Text, FlatList, TextInput, Pressable, Linking, ActivityIndicator } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import ChatBubbleSent from "../../../../components/chat/ChatBubbleSent";
import ChatBubbleReceived from "../../../../components/chat/ChatBubbleReceived";
import Avatar from "../../../../components/ui/Avatar";
import ImageSourcePickerBottomSheet from "../../../../components/bottom-sheets/ImageSourcePickerBottomSheet";
import type { BottomSheetHandle } from "../../../../components/bottom-sheets/BottomSheetWrapper";
import { useMessageStore } from "../../../../store/messageStore";
import { useAuthStore } from "../../../../store/authStore";
import * as api from "../../../../services/api";
import { useChatSafety } from "../../../../hooks/useChatSafety";
import { hasMorePages } from "../../../../utils/pagination";
import { colors } from "../../../../constants";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ChatScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const { chatId: userId } = useLocalSearchParams<{ chatId: string }>();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const imageSheetRef = useRef<BottomSheetHandle | null>(null);
  const listRef = useRef<FlatList>(null);
  // Keep the newest message in view: on first load, when a message arrives,
  // and when the keyboard opening makes the list shorter.
  // Only while the user is already at the bottom, so reading older pages
  // isn't yanked back down by an arriving message or a page loading above.
  const atBottomRef = useRef(true);
  const scrollToLatest = () => {
    if (atBottomRef.current) listRef.current?.scrollToEnd({ animated: false });
  };
  // GET /messages/conversations/:userId pages newest first; page 1 is on screen.
  const [page, setPage] = useState(1);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  // While this chat is on screen, its incoming messages stay silent.
  const setOpenChatUserId = useMessageStore((s) => s.setOpenChatUserId);
  useFocusEffect(
    useCallback(() => {
      setOpenChatUserId(userId ?? null);
      return () => setOpenChatUserId(null);
    }, [userId, setOpenChatUserId]),
  );
  const currentUserId = useAuthStore((s) => s.user?.id);

  const messages = useMessageStore((s) =>
    userId ? (s.messagesByUser[userId] ?? []) : [],
  );
  const conversation = useMessageStore((s) =>
    s.conversations.find((c) => c.userId === userId),
  );
  const setMessages = useMessageStore((s) => s.setMessages);
  const setConversations = useMessageStore((s) => s.setConversations);
  const appendMessage = useMessageStore((s) => s.appendMessage);
  const prependMessages = useMessageStore((s) => s.prependMessages);
  const { blockedByMe, setBlockedByMe, reportMessage, openMenu, unblock } = useChatSafety(userId, conversation?.name);

  const loadOlder = async () => {
    if (!userId || !hasOlder || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const { messages: older, pagination } = await api.getConversationThread(userId, page + 1);
      prependMessages(userId, older);
      setPage(page + 1);
      setHasOlder(hasMorePages(pagination));
    } catch (error) {
      console.error("Load older messages error:", error);
    } finally {
      setLoadingOlder(false);
    }
  };
  const markConversationRead = useMessageStore((s) => s.markConversationRead);

  useEffect(() => {
    if (!userId) return;
    let active = true;

    api
      .getConversationThread(userId)
      .then(({ messages: thread, pagination, blockedByMe: blocked }) => {
        if (!active) return;
        setMessages(userId, thread);
        setBlockedByMe(blocked);
        setPage(1);
        setHasOlder(hasMorePages(pagination));
      })
      .catch((error) => {
        console.error("Load conversation thread error:", error);
        if (active) alertModal.error("Error", "Couldn't load this conversation. Please try again.");
      });

    return () => {
      active = false;
    };
  }, [userId, setMessages]);

  // Name, avatar and phone come from the conversation list. A first chat (from a
  // booking or profile) isn't in it yet, so load it now and again after the
  // first message creates it.
  const loadConversation = useCallback(() => {
    api.getConversations().then(setConversations).catch((e) => console.error("Load conversations error:", e));
  }, [setConversations]);
  const hasConversation = !!conversation;
  useEffect(() => {
    if (!hasConversation) loadConversation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

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
      atBottomRef.current = true;
      appendMessage(userId, message);
      if (!hasConversation) loadConversation();
    } catch (error) {
      console.error("Send message error:", error);
      setInput(text);
      alertModal.error("Error", error instanceof Error ? error.message : "Failed to send message. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const sendImage = async (uri: string) => {
    if (!userId) return;
    try {
      const { url } = await api.uploadChatImage(uri);
      const message = await api.sendMessage(userId, "", url);
      atBottomRef.current = true;
      appendMessage(userId, message);
    } catch (error) {
      console.error("Send image error:", error);
      alertModal.error("Error", "Failed to send image. Please try again.");
    }
  };

  const call = () => {
    if (!conversation?.phone) {
      alertModal.warning("No phone number", "This contact has no phone number on file.");
      return;
    }
    Linking.openURL(`tel:${conversation.phone}`).catch(() =>
      alertModal.error("Error", "Could not open the phone dialer."),
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top", "bottom"]}>
      <View className="flex-row items-center px-4 py-3 border-b border-divider bg-white">
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} className="mr-2">
          <Ionicons name="chevron-back" size={24} color={colors.text.primary} />
        </Pressable>
        <Pressable
          className="mr-3"
          onPress={() =>
            userId &&
            router.push({
              pathname: "/(client)/category/worker/[workerId]",
              params: { workerId: userId },
            })
          }
        >
          <Avatar uri={conversation?.avatar} size="sm" />
        </Pressable>
        <View className="flex-1">
          <Text className="text-text-primary font-bold">
            {conversation?.name ?? "Chat"}
          </Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Call" onPress={call}>
          <Ionicons name="call-outline" size={22} color={colors.text.primary} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="More options" onPress={openMenu} className="ml-4">
          <Ionicons name="ellipsis-vertical" size={20} color={colors.text.primary} />
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <FlatList
          ref={listRef}
          data={messages}
          onContentSizeChange={scrollToLatest}
          onLayout={scrollToLatest}
          onScroll={({ nativeEvent: e }) => {
            atBottomRef.current = e.contentOffset.y + e.layoutMeasurement.height >= e.contentSize.height - 80;
          }}
          scrollEventThrottle={100}
          onStartReached={loadOlder}
          onStartReachedThreshold={0.5}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          ListHeaderComponent={loadingOlder ? <ActivityIndicator className="py-2" /> : null}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
          renderItem={({ item }) =>
            item.senderId === currentUserId ? (
              <ChatBubbleSent
                message={item.content}
                imageUrl={item.imageUrl}
                timestamp={formatTime(item.createdAt)}
                onImagePress={(url) =>
                  router.push({
                    pathname: "/(client)/inbox/image-viewer",
                    params: { imageUrl: url },
                  })
                }
              />
            ) : (
              <ChatBubbleReceived
                message={item.content}
                imageUrl={item.imageUrl}
                timestamp={formatTime(item.createdAt)}
                onLongPress={() => reportMessage(item.id)}
                onImagePress={(url) =>
                  router.push({
                    pathname: "/(client)/inbox/image-viewer",
                    params: { imageUrl: url },
                  })
                }
              />
            )
          }
        />

        {blockedByMe ? (
          <View className="flex-row items-center justify-center p-4 border-t border-divider">
            <Text className="text-text-secondary">You blocked {conversation?.name ?? "this user"}. </Text>
            <Pressable accessibilityRole="button" onPress={unblock}>
              <Text className="text-accent font-semibold">Unblock</Text>
            </Pressable>
          </View>
        ) : (
          <View className="flex-row items-center p-3 border-t border-divider">
            <Pressable accessibilityRole="button" accessibilityLabel="Attach a photo"
              className="p-2 mr-2"
              onPress={() => imageSheetRef.current?.expand()}
            >
              <Ionicons name="attach-outline" size={24} color={colors.text.muted} />
            </Pressable>
            <TextInput
              className="flex-1 bg-card rounded-full px-4 py-2 text-text-primary max-h-24"
              style={{ includeFontPadding: false }}
              placeholder="Message..."
              placeholderTextColor={colors.text.muted}
              value={input}
              onChangeText={setInput}
              multiline
            />
            <Pressable accessibilityRole="button" accessibilityLabel="Send message"
              className={`bg-accent rounded-full p-2 ml-2 ${sending ? "opacity-50" : ""}`}
              onPress={send}
              disabled={sending}
            >
              <Ionicons name="send" size={20} color={colors.white} />
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
      <ImageSourcePickerBottomSheet
        innerRef={imageSheetRef}
        onSelect={sendImage}
      />
    </SafeAreaView>
  );
}
