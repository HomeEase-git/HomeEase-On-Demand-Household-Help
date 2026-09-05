import React from "react";
import { View, Text, Pressable } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import Avatar from "../ui/Avatar";
import StatusBadge from "../ui/StatusBadge";
import type { StatusType } from "../ui/StatusBadge";
import { colors, cardShadow } from "../../constants";

type Request = {
  id: string;
  client: string;
  clientAvatar?: string | null;
  service: string;
  date: string;
  amount: number;
  status: string;
  // Optional richer detail for the worker-facing Job Requests Stream —
  // omitted callers (e.g. the home-screen preview) just don't render this row.
  roomsSummary?: string;
  distanceKm?: number | null;
  payoutEstimate?: number | null;
  tip?: number | null;
};

type Props = {
  request: Request;
  onPress: () => void;
};

export const RequestCard: React.FC<Props> = ({ request, onPress }) => {
  const hasDetailRow = !!request.roomsSummary || request.distanceKm != null || request.payoutEstimate != null;

  return (
    <Pressable
      className="bg-card rounded-2xl p-4 mb-3"
      style={cardShadow}
      onPress={onPress}
    >
      <View className="flex-row items-center">
        <View className="mr-3">
          <Avatar uri={request.clientAvatar} size="md" />
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
          {!!request.tip && request.tip > 0 && (
            <View className="bg-gold/20 rounded-full px-2 py-0.5 mt-1 flex-row items-center">
              <Text className="text-[10px]">🎉</Text>
              <Text className="text-accent text-[10px] font-bold ml-1">+₱{request.tip} tip</Text>
            </View>
          )}
          <View className="mt-1">
            <StatusBadge status={request.status as StatusType} />
          </View>
        </View>
      </View>

      {hasDetailRow && (
        <View className="flex-row items-center flex-wrap gap-x-3 gap-y-1 mt-3 pt-3 border-t border-divider">
          {request.roomsSummary && (
            <View className="flex-row items-center">
              <Ionicons name="home-outline" size={13} color={colors.text.muted} />
              <Text className="text-text-muted text-xs ml-1" numberOfLines={1}>
                {request.roomsSummary}
              </Text>
            </View>
          )}
          {request.distanceKm != null && (
            <View className="flex-row items-center">
              <Ionicons name="navigate-outline" size={13} color={colors.text.muted} />
              <Text className="text-text-muted text-xs ml-1">{request.distanceKm.toFixed(1)} km</Text>
            </View>
          )}
          {request.payoutEstimate != null && (
            <View className="flex-row items-center">
              <Ionicons name="cash-outline" size={13} color={colors.success} />
              <Text className="text-success text-xs font-semibold ml-1">
                Payout ₱{Math.round(request.payoutEstimate)}
              </Text>
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
};

export default RequestCard;
