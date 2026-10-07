import React from "react";
import { View, Text, Pressable } from "react-native";
import { RemoteImage } from "../ui/RemoteImage";

type Props = {
  message: string;
  imageUrl?: string | null;
  timestamp: string;
  onImagePress?: (imageUrl: string) => void;
  onLongPress?: () => void;
};

export const ChatBubbleReceived: React.FC<Props> = ({ message, imageUrl, timestamp, onImagePress, onLongPress }) => {
  return (
    <View className="items-start mb-2">
      <Pressable
        className="bg-card rounded-2xl rounded-bl-sm px-4 py-2 max-w-[75%]"
        onLongPress={onLongPress}
        disabled={!onLongPress}
        accessibilityHint={onLongPress ? "Long press to report" : undefined}
      >
        {imageUrl && (
          <Pressable onPress={() => onImagePress?.(imageUrl)}>
            <RemoteImage
              source={{ uri: imageUrl }}
              className="w-48 h-48 rounded-xl mb-1"
              resizeMode="cover"
            />
          </Pressable>
        )}
        {message ? <Text className="text-brand">{message}</Text> : null}
        <Text className="text-text-muted text-xs mt-1">{timestamp}</Text>
      </Pressable>
    </View>
  );
};

export default ChatBubbleReceived;
