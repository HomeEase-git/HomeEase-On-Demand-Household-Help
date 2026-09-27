import React, { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ScreenSkeleton } from "../feedback/ScreenSkeleton";
import ScreenHeader from "../ui/ScreenHeader";
import DateGridPicker from "../booking4step/DateGridPicker";
import StartTimePicker from "../ui/StartTimePicker";
import PrimaryButton from "../ui/PrimaryButton";
import {
  getBookingDetail,
  getMyCalendar,
  getWorkerDayAvailability,
  getWorkerUnavailableDates,
  requestReschedule,
} from "../../services/api";
import { useAlertModal } from "../../contexts/AlertModalContext";
import { MAX_BOOKING_DAYS_AHEAD, phTodayIso, selectableStartTimes } from "../../utils/bookingTime";

type Props = {
  bookingId: string;
  // Who is asking. The other side accepts or declines.
  as: "client" | "worker";
};

/**
 * Propose a new date + start time for an accepted booking. A client can only
 * pick days the pro works; a worker (e.g. two jobs overlap) sees their own
 * jobs that day. The booking keeps its current time until the other side
 * accepts.
 */
export default function RescheduleRequestForm({ bookingId, as }: Props) {
  const router = useRouter();
  const alertModal = useAlertModal();

  const [loading, setLoading] = useState(true);
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [otherName, setOtherName] = useState<string>(as === "client" ? "your pro" : "the client");
  const [closedDates, setClosedDates] = useState<string[]>([]);
  const [busyTimes, setBusyTimes] = useState<string[]>([]);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const detail = await getBookingDetail(bookingId);
        if (!active) return;
        setWorkerId(detail.worker?.id ?? null);
        setOtherName(
          as === "client" ? (detail.worker?.fullName ?? "your pro") : (detail.client?.fullName ?? "the client"),
        );
        if (as === "client" && detail.worker?.id) {
          setClosedDates(await getWorkerUnavailableDates(detail.worker.id));
        }
      } catch (error) {
        console.error("Load booking for reschedule request error:", error);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [bookingId, as]);

  // Jobs already on the picked day: the pro's (for a client) or my own (for a worker).
  useEffect(() => {
    if (!date) return;
    let active = true;
    const load =
      as === "worker"
        ? getMyCalendar(date, date).then((c) => c.days[0]?.jobs.filter((j) => j.bookingId !== bookingId).map((j) => j.time) ?? [])
        : workerId
          ? getWorkerDayAvailability(workerId, date).then((d) => d.occupied)
          : Promise.resolve([]);
    load
      .then((times) => {
        if (active) setBusyTimes(times);
      })
      .catch(() => {
        if (active) setBusyTimes([]);
      });
    return () => {
      active = false;
    };
  }, [date, as, workerId, bookingId]);

  const selectable = useMemo(() => selectableStartTimes(date), [date]);
  const canSubmit = !!date && !!time && selectable.includes(time);

  const handleSubmit = async () => {
    if (!canSubmit || !date || !time) {
      alertModal.warning("Pick a date and time", "Choose a new date and start time to request.");
      return;
    }
    setSubmitting(true);
    try {
      await requestReschedule(bookingId, date, time);
      alertModal.success(
        "Request Sent",
        `${otherName.charAt(0).toUpperCase()}${otherName.slice(1)} will be notified and can accept or decline the new time.`,
        [{ text: "OK", onPress: () => router.back() }],
      );
    } catch (error: any) {
      console.error("Request reschedule error:", error);
      alertModal.error("Error", error?.message || "Failed to send your reschedule request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Request Reschedule" showBack />
        <ScreenSkeleton />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Request Reschedule" showBack />
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
        <Text className="text-text-secondary text-sm mb-4">
          {as === "client"
            ? `Suggest a new date and start time. ${otherName} has to accept it, and your current time stays booked until then.`
            : `Suggest a new date and start time, e.g. if two of your jobs overlap. ${otherName} has to accept it. If they decline, the booking stays as it is and you must arrive on time — a no-show is cancelled with a penalty.`}
        </Text>

        <Text className="text-text-primary font-bold text-lg mb-3">New date</Text>
        <DateGridPicker
          selectedDate={date}
          onSelect={(iso) => {
            setDate(iso);
            if (time && !selectableStartTimes(iso).includes(time)) setTime(null);
          }}
          unavailableDates={closedDates}
          daysAhead={MAX_BOOKING_DAYS_AHEAD + 1}
        />

        <Text className="text-text-primary font-bold text-lg mt-6 mb-3">New start time</Text>
        <StartTimePicker value={time} onChange={setTime} selectable={selectable} busyTimes={busyTimes} />
        {date === phTodayIso() && (
          <Text className="text-text-muted text-xs mt-2">Same-day times must be at least 2 hours from now.</Text>
        )}

        <View className="mt-8">
          <PrimaryButton
            label={submitting ? "Sending..." : "Send Request"}
            fullWidth
            disabled={!canSubmit || submitting}
            loading={submitting}
            onPress={handleSubmit}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
