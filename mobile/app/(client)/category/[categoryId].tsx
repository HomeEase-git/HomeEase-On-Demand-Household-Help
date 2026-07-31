import React, { useRef, useState, useEffect } from "react";
import { View, Text, FlatList, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import WorkerCard from "../../../components/cards/WorkerCard";
import EmptyState from "../../../components/feedback/EmptyState";
import { searchWorkers } from "../../../services/api";
import FilterSortBottomSheet, {
  SearchFilters,
} from "../../../components/bottom-sheets/FilterSortBottomSheet";
import type { BottomSheetHandle } from "../../../components/bottom-sheets/BottomSheetWrapper";

const DEFAULT_FILTERS: SearchFilters = { sort: "rating", availableOnly: false };

type WorkerListItem = {
  id: string;
  name: string;
  service: string;
  rating: number;
  reviews: number;
  rate: number;
  basePrice: number | null;
  status: "available" | "unavailable";
  avatar: string | null;
};

function formatCategoryTitle(slug: string) {
  return slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizeWorkers(workers: Array<any>): WorkerListItem[] {
  return workers.map((worker) => {
    const rate =
      typeof worker.basePrice === "number"
        ? worker.basePrice
        : typeof worker.rate === "number"
          ? worker.rate
          : 0;

    const status: "available" | "unavailable" =
      worker.status === "unavailable" || worker.status === "busy"
        ? "unavailable"
        : "available";

    return {
      id: worker.id,
      name: worker.name,
      service: worker.service ?? "General service",
      rating: Number(worker.rating ?? 0),
      reviews: Number(worker.reviews ?? 0),
      rate,
      basePrice:
        typeof worker.basePrice === "number"
          ? worker.basePrice
          : typeof worker.rate === "number"
            ? worker.rate
            : null,
      status,
      avatar: worker.avatar ?? null,
    };
  });
}

export default function CategoryDetailScreen() {
  const router = useRouter();
  const { categoryId } = useLocalSearchParams<{ categoryId: string }>();
  const filterRef = useRef<BottomSheetHandle | null>(null);
  const [workers, setWorkers] = useState<WorkerListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_FILTERS);

  const categoryName = categoryId ? categoryId.replace(/-/g, " ") : "Category";
  const title = categoryId ? formatCategoryTitle(categoryId) : "Category";

  useEffect(() => {
    let active = true;

    async function loadWorkers() {
      setLoading(true);
      setError(null);
      try {
        const result = await searchWorkers({
          categoryId: categoryName,
          sortBy: filters.sort,
          availableOnly: filters.availableOnly,
        });
        if (!active) return;
        setWorkers(normalizeWorkers(result.data ?? []));
      } catch (err) {
        if (!active) return;
        setError("Unable to load workers for this category.");
      } finally {
        if (!active) return;
        setLoading(false);
      }
    }

    loadWorkers();
    return () => {
      active = false;
    };
  }, [categoryName, filters]);

  const hasActiveFilters =
    filters.sort !== DEFAULT_FILTERS.sort ||
    filters.availableOnly !== DEFAULT_FILTERS.availableOnly;

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader
        title={title}
        showBack
        rightIcon={hasActiveFilters ? "options" : "options-outline"}
        onRightPress={() => filterRef.current?.expand()}
      />
      <View className="px-4 pb-2">
        <Text className="text-text-secondary text-sm">
          {workers.length} workers available
        </Text>
      </View>
      {loading ? (
        <View className="py-6 items-center">
          <ActivityIndicator size="small" />
          <Text className="text-text-secondary mt-2">Loading workers...</Text>
        </View>
      ) : error ? (
        <View className="py-6 items-center">
          <Text className="text-error">{error}</Text>
        </View>
      ) : workers.length === 0 ? (
        <EmptyState
          title="No workers in this category"
          subtitle={`No workers available for ${title} right now.`}
          actionLabel="Browse All Services"
          onAction={() => router.push("/(client)/category")}
        />
      ) : (
        <FlatList
          data={workers}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
          renderItem={({ item }) => (
            <WorkerCard
              worker={item}
              onPress={() =>
                router.push(`/(client)/category/worker/${item.id}`)
              }
            />
          )}
        />
      )}
      <FilterSortBottomSheet
        innerRef={filterRef}
        value={filters}
        onApply={setFilters}
      />
    </SafeAreaView>
  );
}
