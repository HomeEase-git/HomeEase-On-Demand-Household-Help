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
import { usePullToRefresh } from "../../../hooks/usePullToRefresh";

type RecordTab = "Ongoing" | "Completed" | "Cancelled";
const TABS: RecordTab[] = ["Ongoing", "Completed", "Cancelled"];

// New (PENDING) requests stay on the Requests tab until accepted.
function tabForJob(job: WorkerJob): RecordTab | null {
  if (job.status === "Pending") return null;
  if (job.status === "Completed") return "Completed";
  if (job.status === "Cancelled") return "Cancelled";
  return "Ongoing";
}

export default function RecordsScreen() {
  const router = useRouter();
  // Opens on the jobs in progress — that's what a worker comes here for.
  const [tab, setTab] = useState<RecordTab>("Ongoing");
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
  const refreshControl = usePullToRefresh(load);

  const filtered = jobs.filter((j) => tabForJob(j) === tab);

  // An ongoing job opens straight into the live job screen (arrive, start,
  // quote, complete); a finished one opens its record.
  const handleRecordPress = useCallback(
    (job: WorkerJob) => {
      router.push(tabForJob(job) === "Ongoing" ? `/(worker)/records/job/${job.id}` : `/(worker)/records/${job.id}`);
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
          status: tabForJob(item) ?? "Ongoing",
        }}
        onPress={() => handleRecordPress(item)}
      />
    ),
    [handleRecordPress],
  );

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="px-4 pt-4 pb-2">
        <Text className="text-text-primary text-2xl font-bold">Job Records</Text>
        <View className="flex-row gap-2 mt-3">
          {TABS.map((t) => (
            <Pressable
              key={t}
              className={`px-3 py-2 rounded-xl ${tab === t ? "bg-accent" : "bg-card"}`}
              onPress={() => setTab(t)}
            >
              <Text className={tab === t ? "text-white font-semibold text-sm" : "text-text-secondary text-sm"}>
                {t}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      {loading ? (
        <LoadingSkeleton type="booking" count={4} />
      ) : filtered.length === 0 ? (
        <EmptyState title="No records" />
      ) : (
        <FlatList
          data={filtered}
          refreshControl={refreshControl}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          renderItem={renderItem}
        />
      )}
    </SafeAreaView>
  );
}
