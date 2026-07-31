import React from "react";
import { View, Text, Image, Pressable } from "react-native";

type Props = {
  message: string;
  imageUrl?: string | null;
  timestamp: string;
  onImagePress?: (imageUrl: string) => void;
};

export const ChatBubbleReceived: React.FC<Props> = ({ message, imageUrl, timestamp, onImagePress }) => {
  return (
    <View className="items-start mb-2">
      <View className="bg-card rounded-2xl rounded-bl-sm px-4 py-2 max-w-[75%]">
        {imageUrl && (
          <Pressable onPress={() => onImagePress?.(imageUrl)}>
            <Image
              source={{ uri: imageUrl }}
              className="w-48 h-48 rounded-xl mb-1"
              resizeMode="cover"
            />
          </Pressable>
        )}
        {message ? <Text className="text-brand">{message}</Text> : null}
        <Text className="text-text-muted text-xs mt-1">{timestamp}</Text>
      </View>
    </View>
  );
};

export default ChatBubbleReceived;
