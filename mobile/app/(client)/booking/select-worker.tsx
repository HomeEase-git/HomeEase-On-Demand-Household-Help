import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import { useBookingStore } from "../../../store/bookingStore";
import { getWorkers } from "../../../services/api";
import { useWorkerCapacity } from "../../../hooks/useWorkerCapacity";

type WorkerListItem = {
  id: string;
  name: string;
  service: string;
  rating: number;
  reviews: number;
  basePrice: number | null;
  status: string;
  avatar: string | null;
};

function normalizeWorkers(workers: Array<any>): WorkerListItem[] {
  return workers.map((worker) => ({
    id: worker.id,
    name: worker.name,
    service: worker.service ?? "General service",
    rating: Number(worker.rating ?? 0),
    reviews: Number(worker.reviews ?? 0),
    basePrice:
      typeof worker.basePrice === "number"
        ? worker.basePrice
        : typeof worker.rate === "number"
          ? worker.rate
          : null,
    status: worker.status ?? "available",
    avatar: worker.avatar ?? null,
  }));
}

function WorkerSelectItem({
  item,
  selectedId,
  scheduledDate,
  onSelect,
}: {
  item: WorkerListItem;
  selectedId: string | null;
  scheduledDate: string | null;
  onSelect: (worker: WorkerListItem) => void;
}) {
  const { canAcceptJob, reason } = useWorkerCapacity(item.id, scheduledDate);
  const disabled = !canAcceptJob;

  return (
    <Pressable
      className={`bg-card rounded-2xl p-4 mb-3 ${
        selectedId === item.id ? "border-2 border-accent" : ""
      } ${disabled ? "opacity-50" : ""}`}
      disabled={disabled}
      onPress={() => onSelect(item)}
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-1">
          <Text className="text-text-primary font-bold">{item.name}</Text>
          <Text className="text-text-secondary text-xs mt-1">
            {item.service}
          </Text>
          <Text className="text-accent text-sm mt-1">
            {item.basePrice ? `₱${item.basePrice}` : "Price on request"}
          </Text>
          <Text className="text-text-secondary text-xs mt-1">
            {item.rating.toFixed(1)} ★ • {item.reviews} reviews
          </Text>
          {disabled && (
            <Text className="text-error text-xs mt-1">{reason}</Text>
          )}
        </View>

        <View className="w-6 h-6 rounded-full border-2 border-accent items-center justify-center">
          {selectedId === item.id && (
            <View className="w-3 h-3 rounded-full bg-accent" />
          )}
        </View>
      </View>
    </Pressable>
  );
}

export default function SelectWorkerScreen() {
  const router = useRouter();
  const setDraft = useBookingStore((s) => s.setDraft);
  const draft = useBookingStore((s) => s.draft);

  const [workers, setWorkers] = useState<WorkerListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(draft.workerId);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadWorkers() {
      if (draft.workerLocked) {
        setWorkers([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await getWorkers({
          category: draft.category ?? undefined,
          limit: 50,
        });

        if (!cancelled) {
          setWorkers(normalizeWorkers(result.data ?? []));
        }
      } catch (err) {
        if (!cancelled) {
          setError("Could not load workers. Please try again.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadWorkers();
    return () => {
      cancelled = true;
    };
  }, [draft.category, draft.workerLocked]);

  const handleSelectWorker = (worker: WorkerListItem) => {
    setSelectedId(worker.id);
    setDraft({
      workerId: worker.id,
      workerName: worker.name,
    });
  };

  const handleConfirm = () => {
    if (!selectedId) return;
    const selectedWorker = workers.find((w) => w.id === selectedId);
    setDraft({
      workerId: selectedId,
      workerName: selectedWorker?.name ?? draft.workerName ?? null,
    });
    router.back();
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top"]}>
      <ScreenHeader title="Select a Worker" showBack />

      <View className="px-4 flex-1">
        {!draft.date && (
          <View className="bg-warning/10 rounded-2xl p-3 mb-3">
            <Text className="text-warning text-xs">
              Pick a date first so we can show you which workers are actually available.
            </Text>
          </View>
        )}

        {isLoading ? (
          <View className="py-6 items-center">
            <ActivityIndicator size="small" />
            <Text className="text-text-secondary mt-2">Loading workers...</Text>
          </View>
        ) : error ? (
          <View className="py-6 items-center">
            <Text className="text-error">{error}</Text>
          </View>
        ) : (
          <FlatList
            data={workers}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <WorkerSelectItem
                item={item}
                selectedId={selectedId}
                scheduledDate={draft.date}
                onSelect={handleSelectWorker}
              />
            )}
            ListEmptyComponent={
              <Text className="text-text-secondary text-center mt-4">
                No workers available for this category right now.
              </Text>
            }
          />
        )}

        <View className="py-4">
          <PrimaryButton
            label="Confirm Selection"
            fullWidth
            disabled={!selectedId}
            onPress={handleConfirm}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}
