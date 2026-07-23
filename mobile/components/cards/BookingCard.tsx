import React from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import StatusBadge from "../ui/StatusBadge";
import type { StatusType } from "../ui/StatusBadge";
import { colors } from "../../constants";

type Booking = {
  id: string;
  service: string;
  worker: string;
  date: string;
  status: string;
  amount: number;
  payment?: {
    methodType?: string;
  };
};

type Props = {
  booking: Booking;
  onPress: () => void;
};

export const BookingCard: React.FC<Props> = ({ booking, onPress }) => {
  return (
    <Pressable
      className="bg-card border-2 border-primary rounded-2xl p-4 mb-3 flex-row items-center"
      onPress={onPress}
    >
      <View className="w-10 h-10 bg-accent/20 rounded-full items-center justify-center mr-3">
        <Ionicons
          name="construct-outline"
          size={20}
          color={colors.accent.DEFAULT}
        />
      </View>
      <View className="flex-1">
        <Text className="text-primary font-bold">{booking.service}</Text>
        <Text className="text-primary text-xs">{booking.worker}</Text>
        <Text className="text-text-secondary text-xs">
          {booking.date}
          {booking.payment?.methodType
            ? ` · ${booking.payment.methodType}`
            : ""}
        </Text>
      </View>
      <View className="items-end">
        <StatusBadge status={booking.status as StatusType} />
        <Text className="text-accent font-semibold mt-1">
          ₱{booking.amount}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.text.muted} />
    </Pressable>
  );
};

export default BookingCard;
