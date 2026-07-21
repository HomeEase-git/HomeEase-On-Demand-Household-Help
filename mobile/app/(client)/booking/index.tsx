import React, { useState, useEffect } from "react";
import { View, Text, FlatList, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { BookingCard } from "../../../components/cards/BookingCard";
import { EmptyState } from "../../../components/feedback/EmptyState";
import { LoadingSkeleton } from "../../../components/feedback/LoadingSkeleton";
import { useBookingStore } from "../../../store/bookingStore";
import { colors } from "../../../constants";

const TABS = ["Pending", "Active", "Completed", "Cancelled"] as const;

export default function MyBookingsScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>("Pending");
  const [loading, setLoading] = useState(false);
  const bookings = useBookingStore((s) => s.bookings);
  const clearDraft = useBookingStore((s) => s.clearDraft);

  useFocusEffect(
    React.useCallback(() => {
      setActiveTab("Pending");
      return () => {};
    }, []),
  );

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => {
      setLoading(false);
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  const filtered = bookings.filter((b) => b.status === activeTab);

  return (
    <SafeAreaView className="flex-1 bg-primary-white">
      <View className="px-4 pt-4 pb-2">
        <Text className="text-primary text-2xl font-bold">My Bookings</Text>
        <View className="flex-row mt-3 gap-2">
          {TABS.map((tab) => (
            <Pressable
              key={tab}
              className={`px-3 py-2 rounded-xl ${
                activeTab === tab ? "bg-accent" : "bg-card"
              }`}
              onPress={() => setActiveTab(tab)}
            >
              <Text
                className={
                  activeTab === tab
                    ? "text-white font-semibold text-sm"
                    : "text-text-secondary text-sm"
                }
              >
                {tab}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {loading ? (
        <LoadingSkeleton type="booking" count={4} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No bookings yet"
          subtitle={
            activeTab === "Pending"
              ? "Create a booking to get started"
              : `No ${activeTab.toLowerCase()} bookings`
          }
          actionLabel={activeTab === "Pending" ? "New Booking" : undefined}
          onAction={
            activeTab === "Pending"
              ? () => {
                  clearDraft();
                  router.push("/(client)/booking/new/step-1");
                }
              : undefined
          }
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
          renderItem={({ item }) => (
            <BookingCard
              booking={item}
              onPress={() => router.push(`/(client)/booking/${item.id}`)}
            />
          )}
        />
      )}

      {activeTab === "Pending" && (
        <Pressable
          className="absolute bottom-6 right-6 w-14 h-14 bg-accent rounded-full items-center justify-center"
          onPress={() => {
            clearDraft();
            router.push("/(client)/booking/new/step-1");
          }}
        >
          <Ionicons name="add" size={28} color={colors.white} />
        </Pressable>
      )}
    </SafeAreaView>
  );
}
