import React, { useState, useCallback } from "react";
import { View, Text, FlatList, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import RequestCard from "../../../components/cards/RequestCard";
import EmptyState from "../../../components/feedback/EmptyState";
import { LoadingSkeleton } from "../../../components/feedback/LoadingSkeleton";
import { useWorkerStore, mapApiJob, type ApiWorkerBooking } from "../../../store/workerStore";
import * as api from "../../../services/api";
import { summarizeFlatRoomTypes } from "../../../utils/bookingPriceEstimate";
import { ROOM_TYPE_LABELS } from "../../../types/booking4step.types";
import { usePolling } from "../../../hooks/usePolling";
import { useTabRefresh } from "../../../hooks/useTabRefresh";

const TABS = ["Pending", "Accepted"] as const;
const POLL_INTERVAL_MS = 8000;

export default function RequestsScreen() {
  const router = useRouter();
  const jobs = useWorkerStore((s) => s.jobs);
  const setJobs = useWorkerStore((s) => s.setJobs);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Pending");
  const [loading, setLoading] = useState(true);
  const [focused, setFocused] = useState(false);

  // `silent` skips the loading flag so a background poll refresh doesn't
  // flash the skeleton over an already-rendered list.
  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const bookings = await api.getBookings();
        setJobs((bookings as ApiWorkerBooking[]).map(mapApiJob));
      } catch (error) {
        console.error("Load job requests error:", error);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [setJobs],
  );

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      load();
      return () => setFocused(false);
    }, [load]),
  );

  // New incoming requests should show up without the worker having to
  // background/foreground the screen to trigger the focus refresh above.
  usePolling(() => load(true), POLL_INTERVAL_MS, { paused: !focused });

  useTabRefresh("worker:requests", load);

  const filtered = jobs.filter((j) => j.status === tab);

  const handleRequestPress = useCallback(
    (id: string) => {
      router.push(`/(worker)/requests/${id}`);
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: { item: (typeof filtered)[number] }) => (
      <RequestCard
        request={{
          id: item.id,
          client: item.clientName,
          clientAvatar: item.clientAvatar,
          service: item.service,
          date: item.scheduledDate,
          amount: item.finalPrice ?? item.estimatedPrice,
          status: item.status,
          roomsSummary: item.rooms.length > 0 ? summarizeFlatRoomTypes(item.rooms, ROOM_TYPE_LABELS) : undefined,
          distanceKm: item.distanceMeters != null ? item.distanceMeters / 1000 : null,
          payoutEstimate: item.workerPayoutEstimate,
        }}
        onPress={() => handleRequestPress(item.id)}
      />
    ),
    [handleRequestPress],
  );

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="px-4 pt-4 pb-2">
        <Text className="text-text-primary text-2xl font-bold">Job Requests</Text>
        <View className="flex-row gap-2 mt-3">
          {TABS.map((t) => (
            <Pressable
              key={t}
              className={`px-3 py-2 rounded-xl ${tab === t ? "bg-accent" : "bg-card"}`}
              onPress={() => setTab(t)}
            >
              <Text
                className={
                  tab === t
                    ? "text-white font-semibold text-sm"
                    : "text-text-secondary text-sm"
                }
              >
                {t}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      {loading ? (
        <LoadingSkeleton type="booking" count={4} />
      ) : filtered.length === 0 ? (
        <EmptyState title="No requests yet" />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          renderItem={renderItem}
        />
      )}
    </SafeAreaView>
  );
}
