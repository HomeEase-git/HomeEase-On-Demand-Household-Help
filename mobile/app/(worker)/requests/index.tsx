import React, { useState, useCallback } from "react";
import { View, Text, FlatList, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import RequestCard from "../../../components/cards/RequestCard";
import EmptyState from "../../../components/feedback/EmptyState";
import { LoadingSkeleton } from "../../../components/feedback/LoadingSkeleton";
import { useWorkerStore, mapApiJob, type ApiWorkerBooking } from "../../../store/workerStore";
import * as api from "../../../services/api";

const TABS = ["Pending", "Accepted"] as const;

export default function RequestsScreen() {
  const router = useRouter();
  const jobs = useWorkerStore((s) => s.jobs);
  const setJobs = useWorkerStore((s) => s.setJobs);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Pending");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const bookings = await api.getBookings();
      setJobs((bookings as ApiWorkerBooking[]).map(mapApiJob));
    } catch (error) {
      console.error("Load job requests error:", error);
    } finally {
      setLoading(false);
    }
  }, [setJobs]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

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
          service: item.service,
          date: item.scheduledDate,
          amount: item.finalPrice ?? item.estimatedPrice,
          status: item.status,
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
