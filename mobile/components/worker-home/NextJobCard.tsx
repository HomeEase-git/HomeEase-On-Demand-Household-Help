import React from "react";
import { View, Text, Pressable, Linking } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { StatusBadge } from "../ui/StatusBadge";
import { colors } from "../../constants";
import type { WorkerJob } from "../../store/workerStore";
import { TIME_SLOT_LABELS } from "../../types/booking4step.types";
import { directionsUrl } from "../../utils/workerHome";

type Props = {
  job: WorkerJob;
  onOpen: () => void;
};

/** The worker's next job, with Directions to the client's address. */
export const NextJobCard: React.FC<Props> = ({ job, onOpen }) => {
  const when = new Date(job.scheduledDate).toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" });
  const address = job.location || job.city;
  return (
    <View className="bg-brand rounded-2xl p-4 mx-4 mt-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-white/80 text-xs font-semibold">NEXT JOB</Text>
        <StatusBadge status={job.status} />
      </View>
      <Text className="text-white text-lg font-bold mt-1" numberOfLines={1}>
        {job.service}
      </Text>
      <Text className="text-white/90 text-sm" numberOfLines={1}>
        {job.clientName} · {when}
        {job.timeSlot ? ` · ${TIME_SLOT_LABELS[job.timeSlot]}` : ""}
      </Text>
      {!!address && (
        <View className="flex-row items-start mt-2">
          <Ionicons name="location-outline" size={14} color={colors.white} style={{ marginTop: 2 }} />
          <Text className="text-white/90 text-xs ml-1 flex-1" numberOfLines={2}>
            {address}
          </Text>
        </View>
      )}
      <View className="flex-row gap-3 mt-3">
        {!!address && (
          <Pressable
            className="flex-1 flex-row items-center justify-center rounded-xl py-2.5 bg-white active:opacity-[0.85]"
            onPress={() => Linking.openURL(directionsUrl(address))}
            accessibilityRole="button"
            accessibilityLabel="Get directions"
          >
            <Ionicons name="navigate" size={16} color={colors.brand.DEFAULT} />
            <Text className="text-brand font-semibold ml-2">Directions</Text>
          </Pressable>
        )}
        <Pressable
          className="flex-1 flex-row items-center justify-center rounded-xl py-2.5 border-2 border-white/70 active:opacity-[0.85]"
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel="Open job details"
        >
          <Text className="text-white font-semibold">View job</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.white} />
        </Pressable>
      </View>
    </View>
  );
};

export default NextJobCard;
