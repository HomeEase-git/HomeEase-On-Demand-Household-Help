import React, { useState, useRef, useEffect } from "react";
import { View, Text, FlatList, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import SearchBar from "../../../components/ui/SearchBar";
import WorkerCard from "../../../components/cards/WorkerCard";
import EmptyState from "../../../components/feedback/EmptyState";
import { searchWorkers } from "../../../services/api";
import FilterSortBottomSheet from "../../../components/bottom-sheets/FilterSortBottomSheet";
import type { BottomSheetHandle } from "../../../components/bottom-sheets/BottomSheetWrapper";
import LoadingSkeleton from "../../../components/feedback/LoadingSkeleton";
import { useSearchStore } from "../../../store/searchStore";

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const filterRef = useRef<BottomSheetHandle | null>(null);
  const recentSearches = useSearchStore((s) => s.recentSearches);
  const addSearch = useSearchStore((s) => s.addSearch);
  const clearSearches = useSearchStore((s) => s.clearSearches);

  useEffect(() => {
    let active = true;
    const queryText = query.trim();

    if (!queryText) {
      setResults([]);
      setSearching(false);
      setError(null);
      return;
    }

    setSearching(true);
    setError(null);

    searchWorkers({ query: queryText, page: 1 })
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
  }, [query]);

  const handleChangeQuery = (text: string) => {
    setQuery(text);
    if (text.trim()) {
      addSearch(text.trim());
    }
  };

  const handleClearRecent = () => {
    Alert.alert("Clear recent searches?", undefined, [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", onPress: () => clearSearches() },
    ]);
  };

  return (
    <SafeAreaView className="flex-1 bg-primary-white">
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
          />
        </View>
      </View>

      {!query.trim() && recentSearches.length > 0 && (
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
                  addSearch(term);
                  handleChangeQuery(term);
                }}
              >
                <Text className="text-primary text-sm">{term}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {searching ? (
        <LoadingSkeleton />
      ) : query.trim() ? (
        error ? (
          <View className="px-4 py-6">
            <Text className="text-error">{error}</Text>
          </View>
        ) : results.length === 0 ? (
          <EmptyState
            title="No workers found"
            subtitle={`No results for "${query}"`}
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
        onApply={() => filterRef.current?.close()}
      />
    </SafeAreaView>
  );
}
