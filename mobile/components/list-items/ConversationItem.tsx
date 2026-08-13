import React from "react";
import { View, Text, Pressable } from "react-native";
import Avatar from "../ui/Avatar";

type Conversation = {
  id: string;
  name: string;
  avatar?: string | null;
  lastMessage: string;
  time: string;
  unread: number;
};

type Props = {
  conversation: Conversation;
  onPress: () => void;
};

export const ConversationItem: React.FC<Props> = ({
  conversation,
  onPress,
}) => {
  return (
    <Pressable
      className="flex-row items-center py-4 border-b border-divider"
      onPress={onPress}
    >
      <View className="mr-3">
        <Avatar uri={conversation.avatar} size="md" />
      </View>
      <View className="flex-1">
        <Text className="text-text-primary font-bold">{conversation.name}</Text>
        <Text className="text-text-secondary text-sm" numberOfLines={1}>
          {conversation.lastMessage}
        </Text>
      </View>
      <View className="items-end">
        <Text className="text-text-muted text-xs">{conversation.time}</Text>
        {conversation.unread > 0 && (
          <View className="min-w-[20] h-5 rounded-full bg-accent items-center justify-center mt-1 px-1.5">
            <Text className="text-white text-xs font-bold">
              {conversation.unread}
            </Text>
          </View>
        )}
      </View>
    </Pressable>
  );
};

export default ConversationItem;
