import React, { useRef, useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../../components/icons/AppIcon";
import { useRouter } from "expo-router";
import { SectionHeader } from "../../../components/ui/SectionHeader";
import { PromoBanner } from "../../../components/ui/PromoBanner";
import { CategoryCard } from "../../../components/cards/CategoryCard";
import { WorkerCard } from "../../../components/cards/WorkerCard";
import { NotificationBadge } from "../../../components/ui/NotificationBadge";
import { getServiceTypes, searchWorkers, getPromoBanners, getBookings, type PromoBannerItem } from "../../../services/api";
import { mapApiBooking, type Booking, type ApiBookingListItem } from "../../../store/bookingStore";
import { pickUpcomingBooking, pickBookAgainWorkers, type BookAgainWorker } from "../../../utils/homeBookings";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { Avatar } from "../../../components/ui/Avatar";
import { useNotificationStore } from "../../../store/notificationStore";
import { useAuthStore } from "../../../store/authStore";
import {
  FilterSortBottomSheet,
  type SearchFilters,
} from "../../../components/bottom-sheets/FilterSortBottomSheet";
import { Skeleton } from "../../../components/ui/Skeleton";
import type { BottomSheetHandle } from "../../../components/bottom-sheets/BottomSheetWrapper";
import { colors } from "../../../constants";
import { useTabRefresh } from "../../../hooks/useTabRefresh";
import { usePullToRefresh } from "../../../hooks/usePullToRefresh";
import { usePushNotificationPrompt } from "../../../hooks/usePushNotificationPrompt";

const DEFAULT_FILTERS: SearchFilters = { sort: "rating", availableOnly: false };

type ServiceCategory = {
  id: string;
  name: string;
  count: number;
  icon: string | null;
};

type HomeWorker = {
  id: string;
  name: string;
  service: string;
  rating: number;
  reviews: number;
  priceRangeMin: number | null;
  priceRangeMax: number | null;
  status: "available" | "unavailable";
  avatar: string | null;
};

function timeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function normalizeHomeWorker(worker: any): HomeWorker {
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
    priceRangeMin: typeof worker.priceRangeMin === "number" ? worker.priceRangeMin : null,
    priceRangeMax: typeof worker.priceRangeMax === "number" ? worker.priceRangeMax : null,
    status,
    avatar: worker.avatar ?? null,
  };
}

export default function ClientHomeScreen() {
  const router = useRouter();
  usePushNotificationPrompt();
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const filterRef = useRef<BottomSheetHandle | null>(null);
  const [loading, setLoading] = useState(true);
  const [serviceCategories, setServiceCategories] = useState<ServiceCategory[]>(
    [],
  );
  const [workers, setWorkers] = useState<HomeWorker[]>([]);
  const [banners, setBanners] = useState<(PromoBannerItem & { categorySlug: string | null })[]>([]);
  const [upcoming, setUpcoming] = useState<Booking | null>(null);
  const [bookAgain, setBookAgain] = useState<BookAgainWorker[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_FILTERS);
  const user = useAuthStore((s) => s.user);

  const firstName = user?.name?.split(" ")[0] ?? "there";

  const loadHomeData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [serviceTypes, workersResponse, promoBanners, bookings] = await Promise.all([
        getServiceTypes(),
        // Only the top 3 are shown below — a small fetchLimit avoids
        // downloading a full 50-worker page just for this preview.
        searchWorkers({
          sortBy: filters.sort,
          availableOnly: filters.availableOnly,
          fetchLimit: 6,
        }),
        // Extras: if either fails, its section is just hidden rather than
        // failing the whole home screen.
        getPromoBanners().catch(() => [] as PromoBannerItem[]),
        getBookings().catch(() => [] as ApiBookingListItem[]),
      ]);

      // Category screens are addressed by a slug of the name; banners link by id.
      const slugById = new Map<string, string>(
        serviceTypes.map((st: any) => [st.id, st.name.toLowerCase().replace(/\s+/g, "-")]),
      );
      setBanners(
        promoBanners.map((banner) => ({
          ...banner,
          categorySlug: banner.linkServiceTypeId ? (slugById.get(banner.linkServiceTypeId) ?? null) : null,
        })),
      );
      const myBookings = (bookings as ApiBookingListItem[]).map(mapApiBooking);
      setUpcoming(pickUpcomingBooking(myBookings));
      setBookAgain(pickBookAgainWorkers(myBookings));

      setServiceCategories(
        serviceTypes.map((serviceType: any) => ({
          id: serviceType.name.toLowerCase().replace(/\s+/g, "-"),
          name: serviceType.name,
          count: serviceType.availableWorkerCount ?? 0,
          icon: serviceType.icon ?? null,
        })),
      );

      setWorkers(
        (workersResponse.data ?? []).slice(0, 3).map(normalizeHomeWorker),
      );
    } catch {
      setError("Unable to load home content. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    async function run() {
      await loadHomeData();
    }
    run();
  }, [loadHomeData]);

  useTabRefresh("client:home", loadHomeData);
  const refreshControl = usePullToRefresh(loadHomeData);

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top"]}>
      <ScrollView
        refreshControl={refreshControl}
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-row items-center justify-between px-4 pt-2 pb-2">
          <Text className="text-text-primary text-xl font-bold">HomeEase</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Notifications"
            className="p-2"
            onPress={() => router.push("/(client)/inbox")}
          >
            <Ionicons
              name="notifications-outline"
              size={24}
              color={colors.brand.DEFAULT}
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
        ) : error ? (
          <View className="px-4 py-6">
            <Text className="text-error">{error}</Text>
          </View>
        ) : (
          <>
            <View className="bg-card rounded-2xl p-5 mx-4 mt-4">
              <Text className="text-text-primary font-bold text-xl">
                {timeOfDayGreeting()}, {firstName}! 👋
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

            {upcoming && (
              <Pressable
                className="mx-4 mt-3 rounded-2xl border border-brand/20 bg-brand/5 p-4 flex-row items-center active:opacity-[0.85]"
                onPress={() => router.push(`/(client)/booking/${upcoming.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`Your next booking: ${upcoming.category ?? upcoming.service}`}
              >
                <View className="w-11 h-11 rounded-full bg-brand/10 items-center justify-center mr-3">
                  <Ionicons name="calendar" size={20} color={colors.brand.DEFAULT} />
                </View>
                <View className="flex-1">
                  <Text className="text-text-secondary text-xs">Your next booking</Text>
                  <Text className="text-text-primary font-bold" numberOfLines={1}>
                    {upcoming.category ?? upcoming.service}
                  </Text>
                  <Text className="text-text-secondary text-xs mt-0.5" numberOfLines={1}>
                    {new Date(upcoming.date).toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" })}
                    {upcoming.worker && upcoming.worker !== "Unassigned" ? ` · ${upcoming.worker}` : ""}
                  </Text>
                </View>
                <View className="items-end ml-2">
                  <StatusBadge status={upcoming.status} />
                  <Ionicons name="chevron-forward" size={18} color={colors.text.muted} style={{ marginTop: 6 }} />
                </View>
              </Pressable>
            )}

            {banners.length > 0 && (
              <View className="mx-4">
                <PromoBanner
                  banners={banners.map((banner) => ({
                    id: banner.id,
                    title: banner.title,
                    subtitle: banner.subtitle,
                    image: banner.imageUrl,
                    onPress: banner.categorySlug
                      ? () => router.push(`/(client)/category/${banner.categorySlug}`)
                      : undefined,
                  }))}
                />
              </View>
            )}

            <View className="mx-4 mt-4">
              <SectionHeader
                title="Our Services"
                actionLabel="See All"
                onActionPress={() => router.push("/(client)/category")}
              />
              <FlatList
                data={serviceCategories}
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

            {bookAgain.length > 0 && (
              <View className="mx-4 mt-6">
                <SectionHeader title="Book again" />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
                  {bookAgain.map((w) => (
                    <Pressable
                      key={w.workerId}
                      className="bg-card rounded-2xl p-3 items-center w-28 active:opacity-[0.85]"
                      onPress={() => router.push(`/(client)/category/worker/${w.workerId}`)}
                      accessibilityRole="button"
                      accessibilityLabel={`Book ${w.name} again`}
                    >
                      <Avatar uri={w.avatar} size="md" />
                      <Text className="text-text-primary text-sm font-semibold mt-2 text-center" numberOfLines={1}>
                        {w.name}
                      </Text>
                      <Text className="text-text-secondary text-xs text-center" numberOfLines={1}>
                        {w.service}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}

            <View className="mx-4 mt-6">
              <SectionHeader
                title="Available Workers"
                actionLabel="See All"
                onActionPress={() => router.push("/(client)/category")}
                rightElement={
                  <Pressable accessibilityRole="button" accessibilityLabel="Filter and sort"
                    onPress={() => filterRef.current?.expand()}
                    hitSlop={8}
                  >
                    <Ionicons
                      name="options-outline"
                      size={20}
                      color={
                        filters.sort !== DEFAULT_FILTERS.sort ||
                        filters.availableOnly !== DEFAULT_FILTERS.availableOnly
                          ? colors.accent.DEFAULT
                          : colors.text.muted
                      }
                    />
                  </Pressable>
                }
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
        value={filters}
        onApply={setFilters}
      />
    </SafeAreaView>
  );
}
