import React, { useState, useCallback } from "react";
import { View, Text, FlatList, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import RecordCard from "../../../components/cards/RecordCard";
import EmptyState from "../../../components/feedback/EmptyState";

const RECORDS = [
  {
    id: "rec1",
    client: "Carlo Mendoza",
    service: "House Cleaning",
    date: "2026-03-01",
    amount: 400,
    status: "Completed",
  },
  {
    id: "rec2",
    client: "Liza Torres",
    service: "Plumbing",
    date: "2026-02-28",
    amount: 500,
    status: "Cancelled",
  },
  {
    id: "rec3",
    client: "Anna Cruz",
    service: "Aircon Maintenance",
    date: "2026-03-05",
    amount: 650,
    status: "Ongoing",
  },
];

export default function RecordsScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<"Completed" | "Cancelled" | "Ongoing">(
    "Completed",
  );
  const filtered = RECORDS.filter((r) => r.status === tab);

  const handleRecordPress = useCallback(
    (id: string) => {
      router.push(`/(worker)/records/${id}`);
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: { item: (typeof RECORDS)[number] }) => (
      <RecordCard record={item} onPress={() => handleRecordPress(item.id)} />
    ),
    [handleRecordPress],
  );

  return (
    <SafeAreaView className="flex-1 bg-primary-white">
      <View className="px-4 pt-4 pb-2">
        <Text className="text-primary text-2xl font-bold">Job Records</Text>
        <View className="flex-row gap-2 mt-3">
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
      {filtered.length === 0 ? (
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
