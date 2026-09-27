import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import { colors } from "../../../../constants";
import { useAlertModal } from "../../../../contexts/AlertModalContext";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import StepperHorizontal from "../../../../components/steppers/StepperHorizontal";
import { BookingFooterBar } from "../../../../components/booking4step/BookingFooterBar";
import { useDraftPriceEstimate } from "../../../../hooks/useBookingPriceEstimate";
import InvalidationBanner from "../../../../components/ui/InvalidationBanner";
import AddressPickerBottomSheet, {
  type SavedAddress,
} from "../../../../components/bottom-sheets/AddressPickerBottomSheet";
import type { BottomSheetHandle } from "../../../../components/bottom-sheets/BottomSheetWrapper";
import DateGridPicker from "../../../../components/booking4step/DateGridPicker";
import StartTimePicker from "../../../../components/ui/StartTimePicker";
import { useBookingStore } from "../../../../store/bookingStore";
import { useDateAvailabilityCount } from "../../../../hooks/useWorkerDiscovery";
import * as api from "../../../../services/api";
import { addressStorage } from "../../../../utils/storage";
import { formatStructuredAddress, geocodeAddressWithFallback } from "../../../../utils/geo";
import { RUSH_FEE_RATE, RUSH_MIN_LEAD_HOURS, isRushDate, phTodayIso, selectableStartTimes } from "../../../../utils/bookingTime";

const BOOKING_STEPS = ["Scope", "Schedule", "Who", "Confirm"];

export default function BookingStep2Screen() {
  const router = useRouter();
  // Same estimate as Step 4, from what Step 1 saved (null for custom-quote jobs).
  const draftEstimate = useDraftPriceEstimate();
  const alertModal = useAlertModal();
  const draft = useBookingStore((s) => s.draft);
  const setDraft = useBookingStore((s) => s.setDraft);
  const addressSheetRef = useRef<BottomSheetHandle>(null);

  const [address, setAddress] = useState<string | null>(draft.address);
  const [lat, setLat] = useState<number | undefined>(draft.lat);
  const [lng, setLng] = useState<number | undefined>(draft.lng);
  const [city, setCity] = useState<string | undefined>(draft.city);
  const [date, setDate] = useState<string | null>(draft.date);
  const [time, setTime] = useState<string | null>(draft.time);
  // A profile-picked (locked) worker: the dates they don't work, and the
  // start times of jobs they already have on the picked date.
  const [workerClosedDates, setWorkerClosedDates] = useState<string[]>([]);
  const [workerBusyTimes, setWorkerBusyTimes] = useState<string[]>([]);

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
  const lockedWorkerId = draft.workerLocked ? (draft.workerId ?? null) : null;

  useEffect(() => {
    if (!lockedWorkerId) return;
    let active = true;
    api
      .getWorkerUnavailableDates(lockedWorkerId)
      .then((dates) => {
        if (active) setWorkerClosedDates(dates);
      })
      .catch((error) => console.error("Load worker unavailable dates error:", error));
    return () => {
      active = false;
    };
  }, [lockedWorkerId]);

  useEffect(() => {
    if (!lockedWorkerId || !date) return;
    let active = true;
    api
      .getWorkerDayAvailability(lockedWorkerId, date)
      .then((day) => {
        if (active) setWorkerBusyTimes(day.occupied);
      })
      .catch(() => {
        if (active) setWorkerBusyTimes([]);
      });
    return () => {
      active = false;
    };
  }, [lockedWorkerId, date]);

  // How many pros work on the picked date (for a locked worker: 0 or 1).
  // Workers take several jobs a day, so the start time doesn't change this.
  const { count: prosAvailable, loading: loadingCount } = useDateAvailabilityCount(
    {
      serviceType: draft.serviceType ?? undefined,
      date: date ?? undefined,
      scopeAnswers: draft.scopeAnswers,
      workerId: lockedWorkerId ?? undefined,
    },
    hasScope && !!date
  );

  // Same-day booking: only start times at least RUSH_MIN_LEAD_HOURS away,
  // and today is closed once none are left.
  const today = phTodayIso();
  const todayHasTimes = selectableStartTimes(today).length > 0;
  const selectableTimes = useMemo(() => selectableStartTimes(date), [date]);
  const isRush = isRushDate(date);
  const unavailableDates = useMemo(
    () => [...workerClosedDates, ...(todayHasTimes ? [] : [today])],
    [workerClosedDates, todayHasTimes, today],
  );

  const handleSelectDate = (iso: string) => {
    setDate(iso);
    // Keep the chosen time only if it's still pickable on the new date.
    if (time && !selectableStartTimes(iso).includes(time)) setTime(null);
  };

  const noProsOnDate = !!date && !loadingCount && prosAvailable === 0;

  const canNext = !!address && lat != null && lng != null && !!date && !!time && !noProsOnDate;

  const handleNext = () => {
    if (noProsOnDate) {
      alertModal.warning(
        "No pros available",
        draft.workerLocked
          ? `${draft.workerName ?? "This pro"} isn't working on this date. Try a different date, or go back and choose another pro.`
          : "No pros are available on this date. Try a different date.",
      );
      return;
    }
    if (!canNext) {
      alertModal.warning("Schedule incomplete", "Please set your address, a date, and a start time to continue.");
      return;
    }

    setDraft({ address, lat, lng, city, date, time });
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
        <DateGridPicker
          selectedDate={date}
          onSelect={handleSelectDate}
          unavailableDates={unavailableDates}
          dateBadges={todayHasTimes ? { [today]: "Rush" } : undefined}
        />

        {isRush && (
          <View className="bg-warning/10 rounded-xl px-4 py-3 mt-3 flex-row">
            <Ionicons name="flash-outline" size={18} color={colors.warning} />
            <Text className="text-text-secondary text-sm ml-2 flex-1">
              Same-day booking: a rush fee of {Math.round(RUSH_FEE_RATE * 100)}% of the service price applies. Start
              times must be at least {RUSH_MIN_LEAD_HOURS} hours from now.
            </Text>
          </View>
        )}

        <Text className="text-text-primary font-bold text-lg mt-6 mb-1">Select a start time</Text>
        <Text className="text-text-muted text-xs mb-3">
          {date && !loadingCount && prosAvailable != null
            ? draft.workerLocked
              ? prosAvailable > 0
                ? `${draft.workerName ?? "Your pro"} works on this date.`
                : `${draft.workerName ?? "Your pro"} isn't working on this date.`
              : `${prosAvailable} pro${prosAvailable === 1 ? "" : "s"} available on this date.`
            : "When should your pro arrive?"}
        </Text>
        <StartTimePicker value={time} onChange={setTime} selectable={selectableTimes} busyTimes={workerBusyTimes} />

        {noProsOnDate && (
          <Text className="text-error text-sm mt-2">
            {draft.workerLocked
              ? `${draft.workerName ?? "This pro"} isn't working on this date. Try another date or pro.`
              : "No pros are available on this date. Try another date."}
          </Text>
        )}

      </ScrollView>
      <BookingFooterBar estimate={draftEstimate} noPriceText="Quote after inspection" buttonLabel="Next" onPress={handleNext} />

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
