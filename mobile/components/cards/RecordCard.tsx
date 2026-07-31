import React from "react";
import { View, Text, Pressable } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import StatusBadge from "../ui/StatusBadge";
import type { StatusType } from "../ui/StatusBadge";
import { colors, cardShadow } from "../../constants";

type Record = {
  id: string;
  client: string;
  service: string;
  date: string;
  amount: number;
  status: string;
};

type Props = {
  record: Record;
  onPress: () => void;
};

export const RecordCard: React.FC<Props> = ({ record, onPress }) => {
  const isCompleted = record.status === "Completed";
  const isCancelled = record.status === "Cancelled";
  const isOngoing = record.status === "Ongoing";

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
        <Text className="text-text-primary font-bold">{record.client}</Text>
        <Text className="text-text-secondary text-xs">{record.service}</Text>
        <Text className="text-text-muted text-xs">{record.date}</Text>
      </View>
      <View className="items-end">
        <Text
          className={
            isCompleted
              ? "text-success font-bold"
              : isOngoing
                ? "text-accent font-bold"
                : "text-error font-bold"
          }
        >
          {isCompleted
            ? `+₱${record.amount}`
            : isOngoing
              ? `₱${record.amount}`
              : "Cancelled"}
        </Text>
        <StatusBadge status={record.status as StatusType} />
      </View>
    </Pressable>
  );
};

export default RecordCard;
