import React, { useRef, useState, useEffect } from "react";
import { View, Text, ScrollView, Pressable, FlatList } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SearchBar } from "../../../components/ui/SearchBar";
import { SectionHeader } from "../../../components/ui/SectionHeader";
import { PromoBanner } from "../../../components/ui/PromoBanner";
import { CategoryCard } from "../../../components/cards/CategoryCard";
import { WorkerCard } from "../../../components/cards/WorkerCard";
import { NotificationBadge } from "../../../components/ui/NotificationBadge";
import { workers, categories } from "../../../constants/dummyData";
import { useNotificationStore } from "../../../store/notificationStore";
import { useAuthStore } from "../../../store/authStore";
import { FilterSortBottomSheet } from "../../../components/bottom-sheets/FilterSortBottomSheet";
import { Skeleton } from "../../../components/ui/Skeleton";
import type { BottomSheetHandle } from "../../../components/bottom-sheets/BottomSheetWrapper";
import { colors } from "../../../constants";

const PROMO_BANNERS = [
  { title: "20% Off Cleaning!", color: colors.banner1 },
  { title: "New Workers Near You!", color: colors.banner2 },
  { title: "Book Now, Pay Later!", color: colors.banner3 },
];

export default function ClientHomeScreen() {
  const router = useRouter();
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const filterRef = useRef<BottomSheetHandle | null>(null);
  const [loading, setLoading] = useState(true);
  const user = useAuthStore((s) => s.user);

  const firstName = user?.name?.split(" ")[0] ?? "there";

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(false);
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-primary-white" edges={["top"]}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-row items-center justify-between px-4 pt-2 pb-2">
          <Text className="text-primary text-xl font-bold">HomeEase</Text>
          <Pressable
            className="p-2"
            onPress={() => router.push("/(client)/inbox")}
          >
            <Ionicons
              name="notifications-outline"
              size={24}
              color={colors.primary.DEFAULT}
            />
            <NotificationBadge count={unreadCount} />
          </Pressable>
        </View>

        {loading ? (
          <View className="px-4 mt-4">
            <Skeleton width="70%" height={28} marginBottom={12} />
            <Skeleton width="50%" height={16} marginBottom={24} />
            <Skeleton
              width="100%"
              height={100}
              borderRadius={16}
              marginBottom={24}
            />
            <Skeleton width="80%" height={20} marginBottom={16} />
            {[1, 2, 3].map((i) => (
              <View key={i} className="mb-3">
                <Skeleton width="100%" height={80} borderRadius={12} />
              </View>
            ))}
          </View>
        ) : (
          <>
            <View className="bg-card rounded-2xl p-5 mx-4 mt-4">
              <Text className="text-primary font-bold text-xl">
                Good morning, {firstName}! 👋
              </Text>
              <View className="flex-row items-center mt-2">
                <Ionicons
                  name="location-outline"
                  size={16}
                  color={colors.text.muted}
                />
                <Text className="text-text-secondary text-sm ml-1">
                  Central Luzon, Philippines
                </Text>
              </View>
            </View>

            <View className="mx-4 mt-3">
              <Pressable onPress={() => router.push("/(client)/home/search")}>
                <SearchBar
                  placeholder="Search services or workers..."
                  onFilterPress={() => filterRef.current?.expand()}
                />
              </Pressable>
            </View>

            <View className="mx-4">
              <PromoBanner banners={PROMO_BANNERS} />
            </View>

            <View className="mx-4 mt-4">
              <SectionHeader
                title="Our Services"
                actionLabel="See All"
                onActionPress={() => router.push("/(client)/category")}
              />
              <FlatList
                data={categories}
                horizontal
                showsHorizontalScrollIndicator={false}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <CategoryCard
                    category={item}
                    onPress={() => router.push(`/(client)/category/${item.id}`)}
                  />
                )}
              />
            </View>

            <View className="mx-4 mt-6">
              <SectionHeader
                title="Available Workers"
                actionLabel="See All"
                onActionPress={() => router.push("/(client)/category")}
              />
              {workers.slice(0, 3).map((worker) => (
                <WorkerCard
                  key={worker.id}
                  worker={worker}
                  onPress={() =>
                    router.push(`/(client)/category/worker/${worker.id}`)
                  }
                />
              ))}
            </View>
          </>
        )}
      </ScrollView>
      <FilterSortBottomSheet
        innerRef={filterRef}
        onApply={() => filterRef.current?.close()}
      />
    </SafeAreaView>
  );
}
