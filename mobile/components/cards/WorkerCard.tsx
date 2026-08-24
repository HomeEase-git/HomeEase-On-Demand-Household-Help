import React from "react";
import { View, Text, Pressable } from "react-native";
import Avatar from "../ui/Avatar";
import StarRating from "../ui/StarRating";
import { useWorkerCapacity } from "../../hooks/useWorkerCapacity";
import { cardShadow } from "../../constants";

type Worker = {
  id: string;
  name: string;
  service: string;
  rate: number;
  rating: number;
  reviews: number;
  status: string;
  avatar?: string | null;
  activeJobCount?: number | null;
  maxConcurrentJobs?: number | null;
};

type Props = {
  worker: Worker;
  onPress: () => void;
};

export const WorkerCard: React.FC<Props> = ({ worker, onPress }) => {
  const { isAtCapacity, activeJobCount } = useWorkerCapacity(
    worker.activeJobCount,
    worker.maxConcurrentJobs,
  );

  const isUnavailable =
    worker.status === "unavailable" || worker.status === "busy" || isAtCapacity;

  return (
    <Pressable
      className="bg-card rounded-2xl p-4 mb-3 flex-row items-center"
      style={cardShadow}
      onPress={onPress}
    >
      <View className="mr-3">
        <Avatar uri={worker.avatar} size="md" />
      </View>
      <View className="flex-1">
        <Text className="text-text-primary font-bold" numberOfLines={1}>
          {worker.name}
        </Text>
        <Text className="text-text-secondary text-xs" numberOfLines={1}>
          {worker.service}
        </Text>
        <View className="flex-row items-center mt-1">
          <StarRating rating={worker.rating} size={12} />
          <Text className="text-text-muted text-xs ml-1">
            ({worker.reviews} reviews)
          </Text>
        </View>
        {activeJobCount > 0 && (
          <Text
            className={`text-xs mt-0.5 ${
              isAtCapacity ? "text-error" : "text-warning"
            }`}
          >
            {isAtCapacity
              ? "At full capacity"
              : `${activeJobCount} active job${activeJobCount > 1 ? "s" : ""}`}
          </Text>
        )}
      </View>
      <View className="items-end">
        <Text className="text-accent font-bold">₱{worker.rate}/hr</Text>
        <View
          className={`px-2 py-0.5 rounded-full mt-1 ${
            isUnavailable ? "bg-error/20" : "bg-success/20"
          }`}
        >
          <Text
            className={`text-xs font-semibold ${
              isUnavailable ? "text-error" : "text-success"
            }`}
          >
            {isAtCapacity
              ? "Full"
              : worker.status === "unavailable"
                ? "Busy"
                : "Available"}
          </Text>
        </View>
      </View>
    </Pressable>
  );
};

export default WorkerCard;
