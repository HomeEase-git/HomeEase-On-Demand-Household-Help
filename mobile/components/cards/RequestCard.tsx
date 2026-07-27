import React from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import StatusBadge from "../ui/StatusBadge";
import type { StatusType } from "../ui/StatusBadge";
import { colors, cardShadow } from "../../constants";
type Request = {
  id: string;
  client: string;
  service: string;
  date: string;
  amount: number;
  status: string;
};

type Props = {
  request: Request;
  onPress: () => void;
};

export const RequestCard: React.FC<Props> = ({ request, onPress }) => {
  return (
    <Pressable
      className="bg-card rounded-2xl p-4 mb-3 flex-row items-center"
      style={cardShadow}
      onPress={onPress}
    >
      <View className="w-12 h-12 bg-card-light rounded-full items-center justify-center mr-3">
        <Ionicons name="person-circle" size={40} color={colors.text.muted} />
      </View>
      <View className="flex-1">
        <Text className="text-text-primary font-bold" numberOfLines={1}>
          {request.client}
        </Text>
        <Text className="text-text-secondary text-xs" numberOfLines={1}>
          {request.service}
        </Text>
        <Text className="text-text-muted text-xs">{request.date}</Text>
      </View>
      <View className="items-end">
        <Text className="text-accent font-bold">₱{request.amount}</Text>
        <StatusBadge status={request.status as StatusType} />
      </View>
    </Pressable>
  );
};

export default RequestCard;
