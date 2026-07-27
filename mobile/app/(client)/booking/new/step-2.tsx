import React, { useState, useEffect } from "react";
import { View, Text, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
// eslint-disable-next-line import/no-named-as-default
import ScreenHeader from "../../../../components/ui/ScreenHeader";
// eslint-disable-next-line import/no-named-as-default
import StepperHorizontal from "../../../../components/steppers/StepperHorizontal";
// eslint-disable-next-line import/no-named-as-default
import InputField from "../../../../components/ui/InputField";
// eslint-disable-next-line import/no-named-as-default
import PrimaryButton from "../../../../components/ui/PrimaryButton";
// eslint-disable-next-line import/no-named-as-default
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import BookingCalendar from "../../../../components/ui/BookingCalendar";
import TimeSlotPicker from "../../../../components/ui/TimeSlotPicker";
import InvalidationBanner from "../../../../components/ui/InvalidationBanner";
import { useBookingStore } from "../../../../store/bookingStore";
// eslint-disable-next-line import/no-named-as-default
import useBookingAvailability from "../../../../hooks/useBookingAvailability";
import * as api from "../../../../services/api";

export default function BookingStep2Screen() {
  const router = useRouter();
  const draft = useBookingStore((s) => s.draft);
  const setDraft = useBookingStore((s) => s.setDraft);
  const [date, setDate] = useState(draft.date ?? "");
  const [instructions, setInstructions] = useState(draft.instructions ?? "");
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

        {/* Service summary */}
        <View className="bg-card rounded-2xl p-4 mt-4 mb-2">
          <Text className="text-text-primary font-bold mb-2">Service Summary</Text>
          <Text className="text-text-secondary text-sm">
            {draft.category ?? "No category selected"}
          </Text>
          {draft.estimatedPrice > 0 && (
            <Text className="text-accent text-sm font-semibold mt-1">
              Estimated: ₱{draft.estimatedPrice}
            </Text>
          )}
        </View>

        {/* Calendar */}
        <Text className="text-text-primary font-bold text-lg mt-4 mb-3">
          Select a date
        </Text>
        <InvalidationBanner />
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

        {/* Special instructions */}
        <InputField
          label="Special instructions (optional)"
          value={instructions}
          onChangeText={(t) => {
            setInstructions(t);
            setDraft({ instructions: t });
          }}
          placeholder="Any special requests or notes for the worker..."
          multiline
        />

        <View className="mt-8">
          <PrimaryButton
            label="Next"
            fullWidth
            disabled={!canNext}
            onPress={() => {
              if (!canNext) {
                Alert.alert(
                  "Select a Date",
                  "Please select a date to continue.",
                );
                return;
              }
              setDraft({ date, instructions, time });
              router.push("/(client)/booking/new/step-3");
            }}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
