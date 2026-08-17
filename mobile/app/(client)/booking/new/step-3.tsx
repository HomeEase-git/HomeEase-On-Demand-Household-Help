import React from "react";
import { View, Text, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import Avatar from "../../../../components/ui/Avatar";
import StepperHorizontal from "../../../../components/steppers/StepperHorizontal";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import DiscoveredWorkerCard from "../../../../components/booking4step/DiscoveredWorkerCard";
import SurpriseMeButton from "../../../../components/booking4step/SurpriseMeButton";
import HoldTimerBadge from "../../../../components/booking4step/HoldTimerBadge";
import { useBookingStore } from "../../../../store/bookingStore";
import { useWorkerDiscovery } from "../../../../hooks/useWorkerDiscovery";
import { colors } from "../../../../constants";
import { useAlertModal } from "../../../../contexts/AlertModalContext";
import { now } from "../../../../utils/now";
import type { WorkerCard } from "../../../../types/booking4step.types";

const BOOKING_STEPS = ["Scope", "Schedule", "Who", "Confirm"];

export default function BookingStep3Screen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const draft = useBookingStore((s) => s.draft);
  const setDraft = useBookingStore((s) => s.setDraft);

  const readyToSearch = !!draft.serviceType && !!draft.date && !!draft.timeSlot;

  const { workers, loading, error } = useWorkerDiscovery(
    {
      serviceType: draft.serviceType ?? undefined,
      date: draft.date ?? undefined,
      timeSlot: draft.timeSlot ?? undefined,
      condition: draft.condition ?? undefined,
      rooms: draft.rooms?.map((r) => r.room),
      limit: 20,
    },
    readyToSearch && !draft.workerLocked
  );

  const selectWorker = (worker: WorkerCard) => {
    setDraft({
      workerId: worker.id,
      workerName: worker.fullName,
      workerHourlyRate: worker.hourlyRate,
      workerTier: worker.tier ?? "STANDARD",
      workerEstimatedTotal: worker.estimatedTotal,
      workerAvatar: worker.avatar,
      workerRating: worker.rating,
      serviceTypeId: worker.matchedServiceTypeId,
      selectedPackageIds: [],
      isAutoMatched: false,
      holdStartedAt: now(),
    });
  };

  const chooseSurpriseMe = () => {
    setDraft({
      workerId: null,
      workerName: null,
      workerHourlyRate: null,
      workerTier: null,
      workerEstimatedTotal: null,
      workerAvatar: null,
      workerRating: null,
      isAutoMatched: true,
      holdStartedAt: null,
    });
    router.push("/(client)/booking/new/step-4");
  };

  const canNext = !!draft.workerId || !!draft.isAutoMatched;

  const handleNext = () => {
    if (!canNext) {
      alertModal.warning("Pick a pro", "Select a worker or tap Surprise Me to continue.");
      return;
    }
    router.push("/(client)/booking/new/step-4");
  };

  // Worker was locked in from a profile/"book again" entry point — skip
  // discovery entirely and go straight to confirming that worker.
  if (draft.workerLocked && draft.workerId) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Your pro" showBack />
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
          <StepperHorizontal steps={BOOKING_STEPS} currentStep={2} />
          <View className="bg-card rounded-2xl p-4 mt-4 flex-row items-center">
            <View className="mr-3">
              <Avatar uri={draft.workerAvatar} size="lg" />
            </View>
            <View className="flex-1">
              <Text className="text-text-primary font-bold text-base">{draft.workerName}</Text>
              <Text className="text-text-secondary text-xs mt-0.5">Locked in for this booking</Text>
            </View>
            <Ionicons name="lock-closed" size={18} color={colors.text.muted} />
          </View>
          <View className="mt-8">
            <PrimaryButton label="Next" fullWidth onPress={() => router.push("/(client)/booking/new/step-4")} />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Choose your pro" showBack />
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
        <StepperHorizontal steps={BOOKING_STEPS} currentStep={2} />

        {draft.isAutoMatched ? (
          <View className="bg-accent/10 rounded-2xl p-4 mb-4 flex-row items-center">
            <Text className="text-2xl mr-3">🎲</Text>
            <View className="flex-1">
              <Text className="text-accent font-bold text-sm">We&apos;ll surprise you!</Text>
              <Text className="text-text-secondary text-xs mt-0.5">
                Your best-matched available pro will be assigned when you submit.
              </Text>
            </View>
          </View>
        ) : (
          <SurpriseMeButton onPress={chooseSurpriseMe} />
        )}

        <HoldTimerBadge holdStartedAt={draft.holdStartedAt} workerName={draft.workerName} />

        {loading && (
          <View className="py-10 items-center">
            <ActivityIndicator size="small" />
            <Text className="text-text-secondary mt-2 text-sm">Finding available pros...</Text>
          </View>
        )}

        {!loading && error && (
          <View className="py-10 items-center">
            <Text className="text-error text-sm">{error}</Text>
          </View>
        )}

        {!loading && !error && !draft.isAutoMatched && workers.length === 0 && (
          <View className="py-10 items-center">
            <Ionicons name="sad-outline" size={32} color={colors.text.muted} />
            <Text className="text-text-secondary text-sm mt-2 text-center">
              No pros available for this scope/time. Try a different time slot or tap Surprise Me.
            </Text>
          </View>
        )}

        {!draft.isAutoMatched &&
          workers.map((worker) => (
            <DiscoveredWorkerCard
              key={worker.id}
              worker={worker}
              selected={draft.workerId === worker.id}
              onSelect={() => selectWorker(worker)}
            />
          ))}

        <View className="mt-4">
          <PrimaryButton label="Next" fullWidth onPress={handleNext} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
