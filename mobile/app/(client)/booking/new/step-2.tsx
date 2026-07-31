import React, { useState, useEffect } from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAlertModal } from "../../../../contexts/AlertModalContext";
// eslint-disable-next-line import/no-named-as-default
import ScreenHeader from "../../../../components/ui/ScreenHeader";
// eslint-disable-next-line import/no-named-as-default
import StepperHorizontal from "../../../../components/steppers/StepperHorizontal";
// eslint-disable-next-line import/no-named-as-default
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import BookingCalendar from "../../../../components/ui/BookingCalendar";
import TimeSlotPicker from "../../../../components/ui/TimeSlotPicker";
import InvalidationBanner from "../../../../components/ui/InvalidationBanner";
import { useBookingStore } from "../../../../store/bookingStore";
// eslint-disable-next-line import/no-named-as-default
import useBookingAvailability from "../../../../hooks/useBookingAvailability";
import * as api from "../../../../services/api";

export default function BookingStep2Screen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const draft = useBookingStore((s) => s.draft);
  const setDraft = useBookingStore((s) => s.setDraft);
  const [date, setDate] = useState(draft.date ?? "");
  const [time, setTime] = useState(draft.time ?? null);
  const [disabledSlots, setDisabledSlots] = useState<string[]>([]);
  const [unavailableDates, setUnavailableDates] = useState<string[]>([]);

  const availability = useBookingAvailability({
    workerId: draft.workerId,
    date: date || null,
    time: time || null,
    category: draft.category,
  });

  const canNext = !!date && !!time && !availability.blockSubmit;

  useEffect(() => {
    if (draft.workerId && !draft.workerLocked && !availability.workerOk) {
      const reason =
        "This worker is not available on the selected date, so we cleared your worker selection.";
      useBookingStore.getState().invalidateWorker(reason);
    }
    // Fetch blocked dates when worker changes
  }, [availability.workerOk, date, time, draft.workerId, draft.workerLocked]);

  useEffect(() => {
    let mounted = true;
    const loadBlocked = async () => {
      if (!draft.workerId) {
        setUnavailableDates([]);
        return;
      }
      try {
        const resp = await api.getWorkerBlockedDates(draft.workerId);
        if (mounted) setUnavailableDates(resp.dates || []);
      } catch {
        // ignore
      }
    };
    loadBlocked();
    return () => {
      mounted = false;
    };
  }, [draft.workerId]);

  useEffect(() => {
    let mounted = true;
    const loadOccupied = async () => {
      if (!draft.workerId || !date) {
        setDisabledSlots([]);
        return;
      }
      try {
        const resp = await api.getWorkerAvailability(draft.workerId, date);
        if (mounted) setDisabledSlots(resp.occupied || []);
      } catch {
        // ignore
      }
    };
    loadOccupied();
    return () => {
      mounted = false;
    };
  }, [draft.workerId, date]);

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Schedule" showBack />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 24, paddingBottom: 40 }}
      >
        <StepperHorizontal
          steps={["Service", "Schedule", "Payment"]}
          currentStep={1}
        />

        <InvalidationBanner />

        {/* Calendar */}
        <Text className="text-text-primary font-bold text-lg mt-4 mb-3">
          Select a date
        </Text>
        <BookingCalendar
          workerId={draft.workerId}
          selectedDate={date}
          unavailableDates={unavailableDates}
          onDateSelect={(d) => {
            setDate(d);
            setDraft({ date: d });
          }}
        />

        <Text className="text-text-primary font-bold text-lg mt-4 mb-3">
          Select a time
        </Text>
        <TimeSlotPicker
          value={time}
          onChange={(t) => {
            setTime(t);
            setDraft({ time: t });
          }}
          disabledSlots={disabledSlots}
        />

        <View className="mt-8">
          <PrimaryButton
            label="Next"
            fullWidth
            disabled={!canNext}
            onPress={() => {
              if (!canNext) {
                alertModal.warning(
                  "Select a Date",
                  "Please select a date to continue.",
                );
                return;
              }
              setDraft({ date, time });
              router.push("/(client)/booking/new/step-3");
            }}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
