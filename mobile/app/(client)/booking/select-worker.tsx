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
  onSelect,
}: {
  item: WorkerListItem;
  selectedId: string | null;
  onSelect: (worker: WorkerListItem) => void;
}) {
  return (
    <Pressable
      className={`bg-card rounded-2xl p-4 mb-3 ${
        selectedId === item.id ? "border-2 border-accent" : ""
      }`}
      onPress={() => onSelect(item)}
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-1">
          <Text className="text-primary font-bold">{item.name}</Text>
          <Text className="text-text-secondary text-xs mt-1">
            {item.service}
          </Text>
          <Text className="text-accent text-sm mt-1">
            {item.basePrice ? `₱${item.basePrice}` : "Price on request"}
          </Text>
          <Text className="text-text-secondary text-xs mt-1">
            {item.rating.toFixed(1)} ★ • {item.reviews} reviews
          </Text>
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
    if (selectedId) {
      const selectedWorker = workers.find((w) => w.id === selectedId);
      setDraft({
        workerId: selectedId,
        workerName: selectedWorker?.name ?? draft.workerName ?? null,
      });
    } else {
      setDraft({
        workerId: null,
        workerName: null,
      });
    }

    router.back();
  };

  return (
    <SafeAreaView className="flex-1 bg-primary-white" edges={["top"]}>
      <ScreenHeader title="Select a Worker" showBack />

      <View className="px-4 flex-1">
        <Pressable
          className={`bg-card rounded-2xl p-4 mb-3 flex-row items-center ${
            !selectedId ? "border-2 border-accent" : ""
          }`}
          onPress={() => {
            setSelectedId(null);
            setDraft({ workerId: null, workerName: null });
          }}
        >
          <View className="w-6 h-6 rounded-full border-2 border-accent items-center justify-center mr-3">
            {!selectedId && <View className="w-3 h-3 rounded-full bg-accent" />}
          </View>
          <View className="flex-1">
            <Text className="text-primary font-semibold">
              Any Available Worker
            </Text>
            <Text className="text-text-secondary text-xs mt-0.5">
              We&apos;ll assign the best available worker for your booking
            </Text>
          </View>
        </Pressable>

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
            onPress={handleConfirm}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}
