import React from "react";
import { View, Text, Pressable, Image } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import StarRating from "../ui/StarRating";
import { colors } from "../../constants";
import { TIME_SLOT_LABELS, type WorkerCard } from "../../types/booking4step.types";

const BADGE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  VERIFIED: { bg: "bg-success/10", text: "text-success", label: "Verified" },
  TOP_RATED: { bg: "bg-gold/20", text: "text-accent", label: "Top Rated" },
  NEW: { bg: "bg-brand/10", text: "text-brand", label: "New" },
  HEAVY_DUTY_READY: { bg: "bg-warning/10", text: "text-warning", label: "Heavy-Duty Ready" },
  PRO_TIER: { bg: "bg-accent/10", text: "text-accent", label: "Pro" },
  EXPERT_TIER: { bg: "bg-gold/20", text: "text-accent", label: "Expert" },
};

type Props = {
  worker: WorkerCard;
  selected: boolean;
  onSelect: () => void;
};

export default function DiscoveredWorkerCard({ worker, selected, onSelect }: Props) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onSelect}
      className={`bg-card rounded-2xl p-4 mb-3 border-2 ${selected ? "border-accent" : "border-transparent"}`}
    >
      <View className="flex-row items-start">
        {worker.avatar ? (
          <Image source={{ uri: worker.avatar }} className="w-14 h-14 rounded-full mr-3" />
        ) : (
          <View className="w-14 h-14 bg-brand rounded-full items-center justify-center mr-3">
            <Ionicons name="person" size={28} color={colors.white} />
          </View>
        )}

        <View className="flex-1">
          <Text className="text-text-primary font-bold text-base" numberOfLines={1}>
            {worker.fullName}
          </Text>
          <View className="flex-row items-center mt-1">
            <StarRating rating={worker.rating} size={13} />
            <Text className="text-text-muted text-xs ml-1">({worker.totalReviews})</Text>
          </View>

          {worker.badges.length > 0 && (
            <View className="flex-row flex-wrap gap-1.5 mt-2">
              {worker.badges.map((badge) => {
                const style = BADGE_STYLES[badge];
                if (!style) return null;
                return (
                  <View key={badge} className={`px-2 py-0.5 rounded-full ${style.bg}`}>
                    <Text className={`text-[10px] font-semibold ${style.text}`}>{style.label}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {selected && <Ionicons name="checkmark-circle" size={24} color={colors.accent.DEFAULT} />}
      </View>

      <View className="flex-row items-center justify-between mt-3 pt-3 border-t border-divider">
        <View>
          <Text className="text-text-muted text-xs">Rate</Text>
          <Text className="text-text-primary font-semibold text-sm">
            {worker.hourlyRate != null ? `₱${worker.hourlyRate}/hr` : "—"}
          </Text>
        </View>
        <View>
          <Text className="text-text-muted text-xs">Est. total</Text>
          <Text className="text-accent font-bold text-sm">
            {worker.estimatedTotal != null ? `₱${Math.round(worker.estimatedTotal)}` : "—"}
          </Text>
        </View>
        <View className="items-end">
          <Text className="text-text-muted text-xs">Also open</Text>
          <Text className="text-text-secondary font-medium text-xs" numberOfLines={1}>
            {worker.openSlots.length > 0 ? worker.openSlots.map((s) => TIME_SLOT_LABELS[s]).join(", ") : "—"}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
