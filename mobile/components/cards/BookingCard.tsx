import React from "react";
import { View, Text } from "react-native";
import { PressableScale } from "../ui/PressableScale";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import StatusBadge from "../ui/StatusBadge";
import type { StatusType } from "../ui/StatusBadge";
import { colors, cardShadow } from "../../constants";
import { getCategoryIcon } from "../../utils/categoryIcons";

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
  groupTotalDays?: number | null;
  groupDayIndex?: number | null;
};

type Props = {
  booking: Booking;
  onPress: () => void;
};

export const BookingCard: React.FC<Props> = ({ booking, onPress }) => {
  return (
    <PressableScale
      className="bg-card rounded-2xl p-4 mb-3 flex-row items-center"
      style={cardShadow}
      onPress={onPress}
    >
      <View className="w-10 h-10 bg-accent/20 rounded-full items-center justify-center mr-3">
        <Ionicons
          name={getCategoryIcon(booking.service)}
          size={20}
          color={colors.accent.DEFAULT}
        />
      </View>
      <View className="flex-1">
        <View className="flex-row items-center flex-wrap">
          <Text className="text-text-primary font-bold">{booking.service}</Text>
          {!!booking.groupTotalDays && (
            <View className="bg-accent/10 rounded-full px-2 py-0.5 ml-2">
              <Text className="text-accent text-xs font-bold">
                Day {booking.groupDayIndex ?? "?"} of {booking.groupTotalDays}
              </Text>
            </View>
          )}
        </View>
        <Text className="text-text-secondary text-xs">{booking.worker}</Text>
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
    </PressableScale>
  );
};

export default BookingCard;
