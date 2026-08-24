import React, { useState, useRef, useEffect } from "react";
import { View, Text, FlatList, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import SearchBar from "../../../components/ui/SearchBar";
import WorkerCard from "../../../components/cards/WorkerCard";
import EmptyState from "../../../components/feedback/EmptyState";
import { searchWorkers } from "../../../services/api";
import FilterSortBottomSheet, {
  SearchFilters,
} from "../../../components/bottom-sheets/FilterSortBottomSheet";
import type { BottomSheetHandle } from "../../../components/bottom-sheets/BottomSheetWrapper";
import LoadingSkeleton from "../../../components/feedback/LoadingSkeleton";
import { useSearchStore } from "../../../store/searchStore";
import { useAlertModal } from "../../../contexts/AlertModalContext";

const DEFAULT_FILTERS: SearchFilters = { sort: "rating", availableOnly: false };
const DEBOUNCE_MS = 400;

export default function SearchScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_FILTERS);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const filterRef = useRef<BottomSheetHandle | null>(null);
  const recentSearches = useSearchStore((s) => s.recentSearches);
  const addSearch = useSearchStore((s) => s.addSearch);
  const clearSearches = useSearchStore((s) => s.clearSearches);
  const restoreSearches = useSearchStore((s) => s.restoreSearches);

  useEffect(() => {
    restoreSearches();
  }, [restoreSearches]);

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, DEBOUNCE_MS);

    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    if (!debouncedQuery) return;

    let active = true;

    addSearch(debouncedQuery);

    Promise.resolve().then(() => {
      if (!active) return;
      setSearching(true);
      setError(null);
    });

    searchWorkers({
      query: debouncedQuery,
      page: 1,
      sortBy: filters.sort,
      availableOnly: filters.availableOnly,
    })
      .then((response) => {
        if (!active) return;
        setResults(response.data ?? []);
      })
      .catch(() => {
        if (!active) return;
        setError("Unable to search workers. Please try again.");
        setResults([]);
      })
      .finally(() => {
        if (!active) return;
        setSearching(false);
      });

    return () => {
      active = false;
    };
  }, [debouncedQuery, filters]);

  const handleChangeQuery = (text: string) => {
    setQuery(text);
  };

  const handleApplyFilters = (next: SearchFilters) => {
    setFilters(next);
  };

  const hasActiveFilters =
    filters.sort !== DEFAULT_FILTERS.sort ||
    filters.availableOnly !== DEFAULT_FILTERS.availableOnly;

  const trimmedQuery = query.trim();
  const isPending = trimmedQuery !== "" && trimmedQuery !== debouncedQuery;
  const showLoading = searching || isPending;

  const handleClearRecent = () => {
    alertModal.confirm("Clear recent searches?", undefined, {
      confirmText: "Clear",
      onConfirm: () => clearSearches(),
    });
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center px-4 py-2">
        <Pressable onPress={() => router.back()} className="p-2 mr-2">
          <Text className="text-accent font-semibold">Back</Text>
        </Pressable>
        <View className="flex-1">
          <SearchBar
            placeholder="Search services or workers..."
            value={query}
            onChangeText={handleChangeQuery}
            onFilterPress={() => filterRef.current?.expand()}
            filterActive={hasActiveFilters}
          />
        </View>
      </View>

      {!trimmedQuery && recentSearches.length > 0 && (
        <View className="px-4 mt-2">
          <View className="flex-row justify-between items-center mb-2">
            <Text className="text-text-secondary text-sm">Recent</Text>
            <Pressable onPress={handleClearRecent}>
              <Text className="text-accent text-sm">Clear</Text>
            </Pressable>
          </View>
          <View className="flex-row flex-wrap gap-2">
            {recentSearches.map((term) => (
              <Pressable
                key={term}
                className="bg-card-light rounded-full px-4 py-2"
                onPress={() => {
                  setQuery(term);
                  setDebouncedQuery(term);
                }}
              >
                <Text className="text-brand text-sm">{term}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {showLoading ? (
        <LoadingSkeleton />
      ) : trimmedQuery ? (
        error ? (
          <View className="px-4 py-6">
            <Text className="text-error">{error}</Text>
          </View>
        ) : results.length === 0 ? (
          <EmptyState
            title="No workers found"
            subtitle={`No results for "${debouncedQuery}"`}
          />
        ) : (
          <FlatList
            data={results}
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
        )
      ) : null}

      <FilterSortBottomSheet
        innerRef={filterRef}
        value={filters}
        onApply={handleApplyFilters}
      />
    </SafeAreaView>
  );
}
