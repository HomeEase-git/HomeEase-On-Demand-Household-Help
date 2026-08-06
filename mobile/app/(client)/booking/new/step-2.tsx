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
import { geocodeAddress } from "../../../../utils/geo";
import type { TimeSlot } from "../../../../types/booking4step.types";

const BOOKING_STEPS = ["Scope", "Schedule", "Who", "Confirm"];

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
    const fullAddress = `${item.street}, ${item.city}, ${item.state} ${item.zipCode}`;

    const applySelection = (selLat: number, selLng: number) => {
      setAddress(fullAddress);
      setLat(selLat);
      setLng(selLng);
      setCity(item.city);
      setSelectedAddressId(item.id);
      addressSheetRef.current?.close();
    };

    const cached = await addressStorage.get(item.id);
    if (cached?.lat != null && cached?.lng != null) {
      applySelection(cached.lat, cached.lng);
      return;
    }

    setResolvingId(item.id);
    try {
      const geocoded = await geocodeAddress(fullAddress);
      if (!geocoded) {
        alertModal.error("Error", "Couldn't locate this address on the map. Try editing it from My Addresses.");
        return;
      }
      applySelection(geocoded.geometry.location.lat, geocoded.geometry.location.lng);
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
  const { counts, loading: loadingCounts } = useSlotAvailabilityCounts(
    {
      serviceType: draft.serviceType ?? undefined,
      date: date ?? undefined,
      condition: draft.condition ?? undefined,
      rooms: draft.rooms?.map((r) => r.room),
      lat,
      lng,
    },
    hasScope && !!date && lat != null && lng != null
  );

  const canNext = !!address && lat != null && lng != null && !!date && !!timeSlot;

  const handleNext = () => {
    if (!canNext) {
      alertModal.warning("Schedule incomplete", "Please set your address, a date, and a time slot to continue.");
      return;
    }

    setDraft({ address, lat, lng, city, date, timeSlot });
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

        <View className="mt-8">
          <PrimaryButton label="Next" fullWidth disabled={!canNext} onPress={handleNext} />
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
