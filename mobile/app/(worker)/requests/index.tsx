import React, { useState, useCallback } from "react";
import { View, Text, FlatList, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import RequestCard from "../../../components/cards/RequestCard";
import EmptyState from "../../../components/feedback/EmptyState";
import { useWorkerStore } from "../../../store/workerStore";

const TABS = ["Pending", "Accepted", "Declined"] as const;

export default function RequestsScreen() {
  const router = useRouter();
  const jobRequests = useWorkerStore((s) => s.jobRequests);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Pending");

  const filtered = jobRequests.filter((r) => r.status === tab);

  const handleRequestPress = useCallback(
    (id: string) => {
      router.push(`/(worker)/requests/${id}`);
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: { item: (typeof jobRequests)[number] }) => (
      <RequestCard request={item} onPress={() => handleRequestPress(item.id)} />
    ),
    [handleRequestPress],
  );

  return (
    <SafeAreaView className="flex-1 bg-primary-white">
      <View className="px-4 pt-4 pb-2">
        <Text className="text-primary text-2xl font-bold">Job Requests</Text>
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
      {filtered.length === 0 ? (
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
