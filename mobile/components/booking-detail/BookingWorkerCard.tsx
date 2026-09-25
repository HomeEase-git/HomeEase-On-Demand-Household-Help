import React from "react";
import { View, Text, Pressable } from "react-native";
import { RemoteImage } from "../ui/RemoteImage";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { colors } from "../../constants";

type Props = {
  name: string;
  avatarUrl?: string;
  verified?: boolean;
  onMessage: () => void;
  onCall: () => void;
};

/** The assigned worker, with Message and Call right on the card. */
export const BookingWorkerCard: React.FC<Props> = ({ name, avatarUrl, verified, onMessage, onCall }) => {
  return (
    <View className="bg-card rounded-2xl p-4 mb-3">
      <Text className="text-text-secondary text-xs mb-2">Assigned Worker</Text>
      <View className="flex-row items-center">
        <View className="w-12 h-12 rounded-full bg-accent/20 items-center justify-center overflow-hidden">
          {avatarUrl ? (
            <RemoteImage source={{ uri: avatarUrl }} style={{ width: 48, height: 48 }} resizeMode="cover" />
          ) : (
            <Ionicons name="person" size={24} color={colors.accent.DEFAULT} />
          )}
        </View>
        <View className="ml-3 flex-1">
          <View className="flex-row items-center">
            <Text className="text-text-primary font-semibold" numberOfLines={1}>
              {name}
            </Text>
            {verified && (
              <Ionicons name="checkmark-circle" size={14} color={colors.success} style={{ marginLeft: 4 }} />
            )}
          </View>
          <Text className="text-text-secondary text-xs">
            {verified ? "Verified Professional" : "Professional"}
          </Text>
        </View>
      </View>
      <View className="flex-row gap-3 mt-3">
        <Pressable
          onPress={onMessage}
          className="flex-1 flex-row items-center justify-center rounded-xl py-2.5 bg-brand active:opacity-[0.85]"
          accessibilityRole="button"
          accessibilityLabel={`Message ${name}`}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.white} />
          <Text className="text-white font-semibold ml-2">Message</Text>
        </Pressable>
        <Pressable
          onPress={onCall}
          className="flex-1 flex-row items-center justify-center rounded-xl py-2.5 border-2 border-brand bg-white active:opacity-[0.85]"
          accessibilityRole="button"
          accessibilityLabel={`Call ${name}`}
        >
          <Ionicons name="call-outline" size={18} color={colors.brand.DEFAULT} />
          <Text className="text-brand font-semibold ml-2">Call</Text>
        </Pressable>
      </View>
    </View>
  );
};

export default BookingWorkerCard;
