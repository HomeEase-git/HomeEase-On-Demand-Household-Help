import React from "react";
import { View, Text, Image } from "react-native";

type Props = {
  message: string;
  imageUrl?: string | null;
  timestamp: string;
};

export const ChatBubbleSent: React.FC<Props> = ({ message, imageUrl, timestamp }) => {
  return (
    <View className="items-end mb-2">
      <View className="bg-accent rounded-2xl rounded-br-sm px-4 py-2 max-w-[75%]">
        {imageUrl && (
          <Image
            source={{ uri: imageUrl }}
            className="w-48 h-48 rounded-xl mb-1"
            resizeMode="cover"
          />
        )}
        {message ? <Text className="text-brand">{message}</Text> : null}
        <Text className="text-brand/60 text-xs text-right mt-1">
          {timestamp}
        </Text>
      </View>
    </View>
  );
};

export default ChatBubbleSent;
