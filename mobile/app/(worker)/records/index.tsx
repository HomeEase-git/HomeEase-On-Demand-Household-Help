import React, { useCallback, useState } from "react";
import { View, Text, FlatList, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import RecordCard from "../../../components/cards/RecordCard";
import EmptyState from "../../../components/feedback/EmptyState";
import { LoadingSkeleton } from "../../../components/feedback/LoadingSkeleton";
import { mapApiJob, type ApiWorkerBooking, type WorkerJob } from "../../../store/workerStore";
import * as api from "../../../services/api";
import { getWorkerNetAmount } from "../../../utils/pricing";
import { useTabRefresh } from "../../../hooks/useTabRefresh";

type RecordTab = "Completed" | "Cancelled" | "Ongoing";

function tabForJob(job: WorkerJob): RecordTab {
  if (job.status === "Completed") return "Completed";
  if (job.status === "Cancelled") return "Cancelled";
  return "Ongoing";
}

export default function RecordsScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<RecordTab>("Completed");
  const [jobs, setJobs] = useState<WorkerJob[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const bookings = await api.getBookings();
      setJobs((bookings as ApiWorkerBooking[]).map(mapApiJob));
    } catch (error) {
      console.error("Load records error:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useTabRefresh("worker:records", load);

  const filtered = jobs.filter((j) => tabForJob(j) === tab);

  const handleRecordPress = useCallback(
    (id: string) => {
      router.push(`/(worker)/records/${id}`);
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: { item: WorkerJob }) => (
      <RecordCard
        record={{
          id: item.id,
          client: item.clientName,
          clientAvatar: item.clientAvatar,
          service: item.service,
          date: item.scheduledDate,
          amount:
            tabForJob(item) === "Completed"
              ? getWorkerNetAmount(item)
              : item.finalPrice ?? item.estimatedPrice,
          status: tabForJob(item),
        }}
        onPress={() => handleRecordPress(item.id)}
      />
    ),
    [handleRecordPress],
  );

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="px-4 pt-4 pb-2">
        <Text className="text-text-primary text-2xl font-bold">Job Records</Text>
        <View className="flex-row gap-2 mt-3">
          <Pressable
            className={`px-3 py-2 rounded-xl ${tab === "Ongoing" ? "bg-accent" : "bg-card"}`}
            onPress={() => setTab("Ongoing")}
          >
            <Text
              className={
                tab === "Ongoing"
                  ? "text-white font-semibold text-sm"
                  : "text-text-secondary text-sm"
              }
            >
              Ongoing
            </Text>
          </Pressable>
          <Pressable
            className={`px-3 py-2 rounded-xl ${tab === "Completed" ? "bg-accent" : "bg-card"}`}
            onPress={() => setTab("Completed")}
          >
            <Text
              className={
                tab === "Completed"
                  ? "text-white font-semibold text-sm"
                  : "text-text-secondary text-sm"
              }
            >
              Completed
            </Text>
          </Pressable>
          <Pressable
            className={`px-3 py-2 rounded-xl ${tab === "Cancelled" ? "bg-accent" : "bg-card"}`}
            onPress={() => setTab("Cancelled")}
          >
            <Text
              className={
                tab === "Cancelled"
                  ? "text-white font-semibold text-sm"
                  : "text-text-secondary text-sm"
              }
            >
              Cancelled
            </Text>
          </Pressable>
        </View>
      </View>
      {loading ? (
        <LoadingSkeleton type="booking" count={4} />
      ) : filtered.length === 0 ? (
        <EmptyState title="No records" />
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
