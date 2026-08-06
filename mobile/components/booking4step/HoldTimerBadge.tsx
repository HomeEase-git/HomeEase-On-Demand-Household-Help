import React from "react";
import { View, Text } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { colors } from "../../constants";
import { useBookingHoldTimer } from "../../hooks/useBookingHoldTimer";

type Props = {
  holdStartedAt: number | null | undefined;
  workerName?: string | null;
};

/**
 * 10-minute countdown shown after a worker is selected. Client-side UX
 * affordance only — see hooks/useBookingHoldTimer.ts for why nothing is
 * actually reserved server-side.
 */
export default function HoldTimerBadge({ holdStartedAt, workerName }: Props) {
  const timer = useBookingHoldTimer(holdStartedAt);

  if (!timer.isActive) return null;

  return (
    <View
      className={`flex-row items-center rounded-xl p-3 mb-3 ${timer.isExpiring ? "bg-error/10" : "bg-warning/10"}`}
    >
      <Ionicons name="time-outline" size={18} color={timer.isExpiring ? colors.error : colors.warning} />
      <Text className={`text-xs ml-2 flex-1 ${timer.isExpiring ? "text-error" : "text-warning"}`}>
        {workerName ? `${workerName} is held for you` : "This pro is held for you"} — complete your booking within{" "}
        <Text className="font-bold">{timer.remainingLabel}</Text>
      </Text>
    </View>
  );
}
