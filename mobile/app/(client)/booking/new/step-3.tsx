import React from "react";
import { View, Text, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import { BookingFooterBar } from "../../../../components/booking4step/BookingFooterBar";
import { useDraftPriceEstimate } from "../../../../hooks/useBookingPriceEstimate";
import DiscoveredWorkerCard from "../../../../components/booking4step/DiscoveredWorkerCard";
import SurpriseMeButton from "../../../../components/booking4step/SurpriseMeButton";
import HoldTimerBadge from "../../../../components/booking4step/HoldTimerBadge";
import PackageSelector from "../../../../components/booking4step/PackageSelector";
import { useBookingStore } from "../../../../store/bookingStore";
import { useWorkerDiscovery } from "../../../../hooks/useWorkerDiscovery";
import { colors } from "../../../../constants";
import { useAlertModal } from "../../../../contexts/AlertModalContext";
import { now } from "../../../../utils/now";
import type { WorkerCard } from "../../../../types/booking4step.types";

/**
 * Optional: the client books with the best available worker by default
 * (step 2 goes straight to the review screen). This picker opens only from
 * the review screen's "Choose a worker" and returns there.
 */
export default function BookingStep3Screen() {
  const router = useRouter();
  // Same estimate as the review screen, from what Step 1 saved.
  const draftEstimate = useDraftPriceEstimate();
  const alertModal = useAlertModal();
  const draft = useBookingStore((s) => s.draft);
  const setDraft = useBookingStore((s) => s.setDraft);

  const readyToSearch = !!draft.serviceType && !!draft.date && !!draft.time;

  const { workers, loading, error } = useWorkerDiscovery(
    {
      serviceType: draft.serviceType ?? undefined,
      serviceTaskId: draft.serviceTaskId ?? undefined,
      date: draft.date ?? undefined,
      scopeAnswers: draft.scopeAnswers,
      lat: draft.lat,
      lng: draft.lng,
      limit: 20,
    },
    readyToSearch
  );

  const selectWorker = (worker: WorkerCard) => {
    setDraft({
      workerId: worker.id,
      workerName: worker.fullName,
      workerTier: worker.tier ?? "STANDARD",
      workerEstimatedTotal: worker.estimatedTotal,
      workerPriceBreakdown: worker.priceBreakdown,
      workerUnitPrice: worker.unitPrice,
      workerAvatar: worker.avatar,
      workerRating: worker.rating,
      serviceTypeId: worker.matchedServiceTypeId,
      // Packages belong to a worker, so picking another one clears them.
      selectedPackageIds: draft.workerId === worker.id ? draft.selectedPackageIds : [],
      selectedPackagesTotal: draft.workerId === worker.id ? draft.selectedPackagesTotal : 0,
      isAutoMatched: false,
      holdStartedAt: now(),
    });
  };

  const chooseSurpriseMe = () => {
    setDraft({
      workerId: null,
      workerName: null,
      workerTier: null,
      workerEstimatedTotal: null,
      workerPriceBreakdown: null,
      workerUnitPrice: null,
      workerAvatar: null,
      workerRating: null,
      isAutoMatched: true,
      holdStartedAt: null,
      selectedPackageIds: [],
      selectedPackagesTotal: 0,
    });
    router.back();
  };

  const handleDone = () => {
    if (!draft.workerId) {
      alertModal.warning("Pick a worker", "Tap a worker, or let us find one for you.");
      return;
    }
    router.back();
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Choose a worker" showBack />
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
        <SurpriseMeButton onPress={chooseSurpriseMe} />

        <HoldTimerBadge holdStartedAt={draft.holdStartedAt} workerName={draft.workerName} />

        {loading && (
          <View className="py-10 items-center">
            <ActivityIndicator size="small" />
            <Text className="text-text-secondary mt-2 text-sm">Finding available workers...</Text>
          </View>
        )}

        {!loading && error && (
          <View className="py-10 items-center">
            <Text className="text-error text-sm">{error}</Text>
          </View>
        )}

        {!loading && !error && workers.length === 0 && (
          <View className="py-10 items-center">
            <Ionicons name="sad-outline" size={32} color={colors.text.muted} />
            <Text className="text-text-secondary text-sm mt-2 text-center">
              No workers are available on this date. Try another date or let us find one for you.
            </Text>
          </View>
        )}

        {workers.map((worker) => {
          const selected = !draft.isAutoMatched && draft.workerId === worker.id;
          return (
            <View key={worker.id}>
              <DiscoveredWorkerCard
                worker={worker}
                selected={selected}
                onSelect={() => selectWorker(worker)}
                unitLabel={draft.selectedTaskUnitLabel}
              />
              {/* The chosen worker's own packages (optional add-ons with a price). */}
              {selected && (
                <View className="mb-4 -mt-1">
                  <Text className="text-text-primary font-bold text-base mb-2">
                    {worker.fullName}&apos;s packages (optional)
                  </Text>
                  <PackageSelector
                    workerId={worker.id}
                    serviceTypeId={draft.serviceTypeId}
                    selected={draft.selectedPackageIds ?? []}
                    onChange={(ids) => setDraft({ selectedPackageIds: ids })}
                    onSelectedTotalChange={(total) => setDraft({ selectedPackagesTotal: total })}
                  />
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
      <BookingFooterBar
        estimate={draftEstimate}
        buttonLabel="Use This Worker"
        onPress={handleDone}
      />
    </SafeAreaView>
  );
}
