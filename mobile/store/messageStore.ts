import { create } from "zustand";

export type Message = {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  imageUrl?: string | null;
  isRead?: boolean;
  createdAt: string;
};

export type Conversation = {
  userId: string;
  name: string;
  avatar: string | null;
  phone?: string | null;
  lastMessage: string;
  lastMessageTime: string;
  unread: number;
};

type MessageState = {
  conversations: Conversation[];
  messagesByUser: Record<string, Message[]>;
  setConversations: (conversations: Conversation[]) => void;
  setMessages: (userId: string, messages: Message[]) => void;
  appendMessage: (userId: string, message: Message) => void;
  markConversationRead: (userId: string) => void;
  receiveMessage: (currentUserId: string, message: Message) => void;
};

export const useMessageStore = create<MessageState>((set) => ({
  conversations: [],
  messagesByUser: {},

  setConversations: (conversations) => set({ conversations }),

  setMessages: (userId, messages) =>
    set((state) => ({
      messagesByUser: { ...state.messagesByUser, [userId]: messages },
    })),

  appendMessage: (userId, message) =>
    set((state) => {
      const existing = state.messagesByUser[userId] ?? [];
      const updatedConversations = state.conversations.map((c) =>
        c.userId === userId
          ? { ...c, lastMessage: message.content, lastMessageTime: message.createdAt }
          : c,
      );
      return {
        messagesByUser: { ...state.messagesByUser, [userId]: [...existing, message] },
        conversations: updatedConversations,
      };
    }),

  markConversationRead: (userId) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.userId === userId ? { ...c, unread: 0 } : c,
      ),
    })),

  receiveMessage: (currentUserId, message) =>
    set((state) => {
      const otherUserId =
        message.senderId === currentUserId ? message.receiverId : message.senderId;
      const existing = state.messagesByUser[otherUserId] ?? [];
      const alreadyHave = existing.some((m) => m.id === message.id);
      const messagesByUser = alreadyHave
        ? state.messagesByUser
        : { ...state.messagesByUser, [otherUserId]: [...existing, message] };

      const isIncoming = message.receiverId === currentUserId;
      const conversations = state.conversations.map((c) =>
        c.userId === otherUserId
          ? {
              ...c,
              lastMessage: message.content || (message.imageUrl ? "📷 Image" : c.lastMessage),
              lastMessageTime: message.createdAt,
              unread: isIncoming ? c.unread + 1 : c.unread,
            }
          : c,
      );

      return { messagesByUser, conversations };
    }),
}));
