import React, { useCallback, useRef, useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import { colors } from "../../../../constants";
import { useAlertModal } from "../../../../contexts/AlertModalContext";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import StepperHorizontal from "../../../../components/steppers/StepperHorizontal";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import InvalidationBanner from "../../../../components/ui/InvalidationBanner";
import AddressPickerBottomSheet, {
  type SavedAddress,
} from "../../../../components/bottom-sheets/AddressPickerBottomSheet";
import type { BottomSheetHandle } from "../../../../components/bottom-sheets/BottomSheetWrapper";
import DateGridPicker from "../../../../components/booking4step/DateGridPicker";
import TimeSlotPicker from "../../../../components/ui/TimeSlotPicker";
import { useBookingStore } from "../../../../store/bookingStore";
import { useSlotAvailabilityCounts } from "../../../../hooks/useWorkerDiscovery";
import * as api from "../../../../services/api";
import { addressStorage } from "../../../../utils/storage";
import { formatStructuredAddress, geocodeAddressWithFallback } from "../../../../utils/geo";
import { TIME_SLOTS, type TimeSlot } from "../../../../types/booking4step.types";

const BOOKING_STEPS = ["Scope", "Schedule", "Who", "Confirm"];
// Mirrors backend validation.ts's MAX_MULTI_DAY_BOOKING_DAYS — kept as a
// separate constant (not fetched) since it changes rarely and the real
// enforcement lives server-side regardless.
const MAX_MULTI_DAY_BOOKING_DAYS = 14;

export default function BookingStep2Screen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const draft = useBookingStore((s) => s.draft);
  const setDraft = useBookingStore((s) => s.setDraft);
  const addressSheetRef = useRef<BottomSheetHandle>(null);

  const [address, setAddress] = useState<string | null>(draft.address);
  const [lat, setLat] = useState<number | undefined>(draft.lat);
  const [lng, setLng] = useState<number | undefined>(draft.lng);
  const [city, setCity] = useState<string | undefined>(draft.city);
  const [date, setDate] = useState<string | null>(draft.date);
  const [timeSlot, setTimeSlot] = useState<TimeSlot | null>(draft.timeSlot);
  // Multi-day upfront booking — only offered when the client already locked
  // in a specific worker (see worker[workerId].tsx's "Book Now"), since a
  // multi-day job needs one committed worker across every day and there's
  // no auto-match equivalent for that. 1 = an ordinary single-day booking.
  const [dayCount, setDayCount] = useState<number>(draft.dayCount ?? 1);

  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [loadingAddresses, setLoadingAddresses] = useState(true);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const loadAddresses = useCallback(async () => {
    setLoadingAddresses(true);
    try {
      const data = await api.getAddresses();
      setAddresses(data);
    } catch (error) {
      console.error("Load addresses error:", error);
    } finally {
      setLoadingAddresses(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadAddresses();
    }, [loadAddresses])
  );

  const handleSelectAddress = async (item: SavedAddress) => {
    const fullAddress = formatStructuredAddress({
      houseNumber: item.houseNumber ?? undefined,
      street: item.street,
      barangay: item.barangay ?? undefined,
      city: item.city,
      state: item.state,
      zipCode: item.zipCode,
    });

    const applySelection = (selLat: number, selLng: number) => {
      setAddress(fullAddress);
      setLat(selLat);
      setLng(selLng);
      setCity(item.city);
      setSelectedAddressId(item.id);
      addressSheetRef.current?.close();
    };

    // Backend-persisted coordinates (set when the address was last
    // saved/geocoded — see UserAddress.lat/lng) are the most trustworthy
    // source and need no network round-trip; the on-device cache is a
    // fallback for addresses saved before that column existed.
    if (item.lat != null && item.lng != null) {
      applySelection(item.lat, item.lng);
      return;
    }

    const cached = await addressStorage.get(item.id);
    if (cached?.lat != null && cached?.lng != null) {
      applySelection(cached.lat, cached.lng);
      return;
    }

    setResolvingId(item.id);
    try {
      const geocoded = await geocodeAddressWithFallback({
        houseNumber: item.houseNumber ?? undefined,
        street: item.street,
        barangay: item.barangay ?? undefined,
        city: item.city,
        state: item.state,
        zipCode: item.zipCode,
      });
      if (!geocoded) {
        alertModal.error("Error", "Couldn't locate this address on the map. Try editing it from My Addresses.");
        return;
      }
      applySelection(geocoded.geometry.location.lat, geocoded.geometry.location.lng);
      if (geocoded.approximate) {
        alertModal.info(
          "Approximate location",
          "We could only find the general area for this address. For a precise pin, edit it in My Addresses and use \"Use my current location\".",
        );
      }
    } catch (error) {
      console.error("Geocode saved address error:", error);
      alertModal.error("Error", "Couldn't locate this address on the map. Try editing it from My Addresses.");
    } finally {
      setResolvingId(null);
    }
  };

  const handleAddNew = () => {
    addressSheetRef.current?.close();
    router.push("/(client)/profile/addresses/new");
  };

  const hasScope = !!draft.serviceType;
  // When entering via a locked (profile-picked) worker, scope the slot-count
  // check to that specific worker instead of "how many pros total" — a
  // locked worker's own real WorkerAvailability rows are what step-4's
  // createBooking will actually check, so surfacing per-slot availability
  // here (via the same TimeSlotPicker "N pros/None available" UI) catches a
  // dead slot before the user fills in steps 3-4, instead of a confusing
  // failure at final submit.
  const { counts, loading: loadingCounts } = useSlotAvailabilityCounts(
    {
      serviceType: draft.serviceType ?? undefined,
      date: date ?? undefined,
      scopeAnswers: draft.scopeAnswers,
      workerId: draft.workerLocked ? (draft.workerId ?? undefined) : undefined,
    },
    hasScope && !!date
  );

  const noSlotsForLockedWorker =
    draft.workerLocked &&
    !!date &&
    !loadingCounts &&
    TIME_SLOTS.every((slot) => counts[slot] === 0);

  const canNext =
    !!address && lat != null && lng != null && !!date && !!timeSlot && !noSlotsForLockedWorker;

  const handleNext = () => {
    if (noSlotsForLockedWorker) {
      alertModal.warning(
        "No slots available",
        `${draft.workerName ?? "This pro"} isn't available on this date. Try a different date, or go back and choose another pro.`,
      );
      return;
    }
    if (!canNext) {
      alertModal.warning("Schedule incomplete", "Please set your address, a date, and a time slot to continue.");
      return;
    }

    setDraft({ address, lat, lng, city, date, timeSlot, dayCount: draft.workerLocked ? dayCount : 1 });
    router.push("/(client)/booking/new/step-3");
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="When & where?" showBack />
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
        <StepperHorizontal steps={BOOKING_STEPS} currentStep={1} />
        <InvalidationBanner />

        <Text className="text-text-primary font-bold text-lg mt-2 mb-3">Service address</Text>
        <Pressable
          onPress={() => addressSheetRef.current?.expand()}
          className="bg-card rounded-xl px-4 py-4 flex-row items-center"
        >
          <Ionicons name="location-outline" size={20} color={colors.accent.DEFAULT} />
          <Text
            className={`flex-1 ml-3 ${address ? "text-text-primary" : "text-text-muted"}`}
            numberOfLines={1}
          >
            {address || "Select an address"}
          </Text>
          <Ionicons name="chevron-down" size={18} color={colors.text.muted} />
        </Pressable>

        <Text className="text-text-primary font-bold text-lg mt-6 mb-3">Select a date</Text>
        <DateGridPicker selectedDate={date} onSelect={setDate} />

        <Text className="text-text-primary font-bold text-lg mt-6 mb-3">Select a time</Text>
        <TimeSlotPicker
          value={timeSlot}
          onChange={setTimeSlot}
          counts={date ? counts : undefined}
          loadingCounts={loadingCounts}
        />

        {noSlotsForLockedWorker && (
          <Text className="text-error text-sm mt-2">
            {draft.workerName ?? "This pro"} isn&apos;t available on this date for the selected service. Try a
            different date, or go back and choose another pro.
          </Text>
        )}

        {draft.workerLocked && (
          <>
            <Text className="text-text-primary font-bold text-lg mt-6 mb-1">Multi-day job?</Text>
            <Text className="text-text-secondary text-sm mb-3">
              Book {draft.workerName ?? "this pro"} for the same time slot on multiple consecutive days, starting
              from the date above.
            </Text>
            <View className="bg-card rounded-xl px-4 py-3 flex-row items-center justify-between">
              <Text className="text-text-primary font-semibold">
                {dayCount === 1 ? "Single day" : `${dayCount} consecutive days`}
              </Text>
              <View className="flex-row items-center">
                <Pressable
                  className="w-9 h-9 rounded-full bg-surface items-center justify-center"
                  disabled={dayCount <= 1}
                  onPress={() => setDayCount((c) => Math.max(1, c - 1))}
                >
                  <Ionicons name="remove" size={18} color={dayCount <= 1 ? colors.text.muted : colors.brand.DEFAULT} />
                </Pressable>
                <Text className="text-text-primary font-bold text-base mx-4">{dayCount}</Text>
                <Pressable
                  className="w-9 h-9 rounded-full bg-surface items-center justify-center"
                  disabled={dayCount >= MAX_MULTI_DAY_BOOKING_DAYS}
                  onPress={() => setDayCount((c) => Math.min(MAX_MULTI_DAY_BOOKING_DAYS, c + 1))}
                >
                  <Ionicons
                    name="add"
                    size={18}
                    color={dayCount >= MAX_MULTI_DAY_BOOKING_DAYS ? colors.text.muted : colors.brand.DEFAULT}
                  />
                </Pressable>
              </View>
            </View>
          </>
        )}

        <View className="mt-8">
          <PrimaryButton label="Next" fullWidth onPress={handleNext} />
        </View>
      </ScrollView>

      <AddressPickerBottomSheet
        innerRef={addressSheetRef}
        addresses={addresses}
        loading={loadingAddresses}
        selectedAddressId={selectedAddressId}
        resolvingId={resolvingId}
        onSelect={handleSelectAddress}
        onAddNew={handleAddNew}
      />
    </SafeAreaView>
  );
}
