import React, { useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, Animated, Easing, Pressable, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../../components/icons/AppIcon";
import { useRouter } from "expo-router";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../components/ui/OutlinedButton";
import { colors } from "../../../constants";
import { useBookingStore } from "../../../store/bookingStore";
import { useAlertModal } from "../../../contexts/AlertModalContext";
import * as api from "../../../services/api";
import { TIME_SLOT_LABELS, type TimeSlot } from "../../../types/booking4step.types";

const POLL_INTERVAL_MS = 5000;
const CANCEL_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours
const TERMINAL_STATUSES = ["COMPLETED", "CANCELLED", "REJECTED"];

type BookingDetail = {
  id: string;
  status: string;
  createdAt: string;
  scheduledDate?: string;
  timeSlot?: TimeSlot | null;
  location?: string;
  worker?: { id: string; fullName: string } | null;
};

export default function BookingSuccessScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const selectedBooking = useBookingStore((s) => s.selectedBooking);
  const updateBookingStatus = useBookingStore((s) => s.updateBookingStatus);
  const [scaleAnim] = useState(() => new Animated.Value(0));
  const [opacityAnim] = useState(() => new Animated.Value(0));

  const [detail, setDetail] = useState<BookingDetail | null>(null);
  const [canCancel, setCanCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    Animated.timing(scaleAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    Animated.timing(opacityAnim, { toValue: 1, duration: 500, delay: 300, useNativeDriver: true }).start();
  }, [scaleAnim, opacityAnim]);

  // Status tracker: poll booking detail every 5s until it reaches a terminal
  // status. This also resolves the real worker (id + name), which the
  // creation response doesn't include when the booking was auto-matched.
  useEffect(() => {
    if (!selectedBooking?.id) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const data = await api.getBookingDetail(selectedBooking.id);
        if (cancelled) return;
        setDetail(data);
        setCanCancel(
          !TERMINAL_STATUSES.includes(data.status) &&
            Date.now() - new Date(data.createdAt).getTime() < CANCEL_WINDOW_MS
        );
        if (TERMINAL_STATUSES.includes(data.status) && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch {
        // transient network errors shouldn't stop polling
      }
    };

    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [selectedBooking?.id]);

  const referenceNumber = selectedBooking?.id ?? "Pending";
  const workerName = detail?.worker?.fullName ?? selectedBooking?.worker;
  const isAutoMatched = !selectedBooking?.workerId && !!workerName;

  const handleMessageWorker = () => {
    const workerId = detail?.worker?.id;
    if (!workerId) {
      alertModal.info("Not yet available", "We'll let you know as soon as a pro is confirmed for this booking.");
      return;
    }
    router.push(`/(client)/inbox/chat/${workerId}`);
  };

  const handleCancelBooking = () => {
    if (!selectedBooking) return;
    alertModal.confirm("Cancel this booking?", "This can't be undone. Any payment hold will be released.", {
      destructive: true,
      confirmText: "Cancel Booking",
      cancelText: "Keep Booking",
      onConfirm: async () => {
        setCancelling(true);
        try {
          await api.cancelBooking(selectedBooking.id, "Cancelled by client within grace window");
          updateBookingStatus(selectedBooking.id, "Cancelled");
          setDetail((prev) => (prev ? { ...prev, status: "CANCELLED" } : prev));
          alertModal.success("Booking cancelled", "Your booking has been cancelled.");
        } catch (err) {
          alertModal.error("Couldn't cancel", err instanceof Error ? err.message : "Please try again.");
        } finally {
          setCancelling(false);
        }
      },
    });
  };

  const handleAddToCalendar = () => {
    if (!detail?.scheduledDate) {
      alertModal.info("Not scheduled yet", "We'll have your exact date/time once your pro is confirmed.");
      return;
    }
    // No native calendar module is wired into this app (no expo-calendar
    // dependency) — opens Google Calendar's web event-creation page instead,
    // which needs no native permissions/rebuild and works cross-platform.
    const start = new Date(detail.scheduledDate);
    const startStr = start.toISOString().replace(/[-:]|\.\d{3}/g, "");
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const endStr = end.toISOString().replace(/[-:]|\.\d{3}/g, "");
    const title = encodeURIComponent(`HomeEase: ${selectedBooking?.category || selectedBooking?.service || "Service"}`);
    const details = encodeURIComponent(`Booking reference ${referenceNumber}`);
    const location = encodeURIComponent(detail.location || selectedBooking?.address || "");
    const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startStr}/${endStr}&details=${details}&location=${location}`;
    Linking.openURL(url).catch(() => {
      alertModal.error("Couldn't open calendar", "Please try again.");
    });
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 24, paddingVertical: 40, alignItems: "center" }}
      >
        <Animated.View style={{ transform: [{ scale: scaleAnim }], marginBottom: 32 }}>
          <View className="w-40 h-40 bg-success/20 rounded-full items-center justify-center">
            <Ionicons name="checkmark-circle" size={100} color={colors.success} />
          </View>
        </Animated.View>

        <Animated.View style={{ opacity: opacityAnim, width: "100%" }}>
          <Text className="text-text-primary text-3xl font-bold text-center mb-2">Booking Confirmed!</Text>
          <Text className="text-text-secondary text-center text-base mb-8">
            {isAutoMatched
              ? `You've been matched with ${workerName}!`
              : "Your booking request has been submitted successfully."}
          </Text>

          <View className="bg-green-50 rounded-2xl p-4 mb-4">
            <InfoRow icon="checkmark" label={detail ? statusLabel(detail.status) : "Request submitted"} />
            <InfoRow
              icon="calendar"
              label={`${selectedBooking?.date ?? "—"}${
                detail?.timeSlot ? ` · ${TIME_SLOT_LABELS[detail.timeSlot]}` : ""
              }`}
            />
            <InfoRow icon="location" label={selectedBooking?.address || "Location set"} last />
          </View>

          <View className="bg-card border border-accent rounded-2xl p-4 mb-6">
            <Text className="text-text-secondary text-xs mb-1">Booking Reference</Text>
            <Text className="text-text-primary font-bold text-lg mb-3">{referenceNumber}</Text>
            <View className="border-t border-divider pt-3">
              <Text className="text-text-secondary text-xs mb-1">Service</Text>
              <Text className="text-brand font-semibold">
                {selectedBooking?.category || selectedBooking?.service || "Service"}
              </Text>
            </View>
          </View>

          <View className="flex-row gap-2 mb-6">
            <QuickAction icon="chatbubble-ellipses-outline" label="Message Pro" onPress={handleMessageWorker} />
            <QuickAction icon="calendar-outline" label="Add to Calendar" onPress={handleAddToCalendar} />
            <QuickAction
              icon="close-circle-outline"
              label="Cancel"
              onPress={handleCancelBooking}
              disabled={!canCancel || cancelling}
              destructive
            />
          </View>
          {!canCancel && detail && !TERMINAL_STATUSES.includes(detail.status) && (
            <Text className="text-text-muted text-xs text-center mb-4 -mt-4">
              Free cancellation window (2 hours after booking) has passed.
            </Text>
          )}

          <Text className="text-text-secondary text-center text-sm mb-8">
            You&apos;ll get a notification once your pro accepts the booking.
          </Text>
        </Animated.View>

        <View className="w-full gap-3">
          <OutlinedButton
            label="Track My Booking"
            onPress={() => {
              if (selectedBooking) router.push(`/(client)/booking/${selectedBooking.id}`);
              else router.push("/(client)/booking");
            }}
          />
          <PrimaryButton label="Go to Home" fullWidth onPress={() => router.replace("/(client)/home")} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    PENDING: "Waiting for a pro to accept",
    ACCEPTED: "Accepted — pro is on the way",
    IN_PROGRESS: "Job in progress",
    QUOTE_SUBMITTED: "Quote submitted — review needed",
    QUOTE_APPROVED: "Quote approved",
    PENDING_COMPLETION: "Awaiting your confirmation",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
    REJECTED: "Cancelled",
    DISPUTED: "Under review",
  };
  return labels[status] ?? "Request submitted";
}

function InfoRow({ icon, label, last }: { icon: string; label: string; last?: boolean }) {
  return (
    <View className={`flex-row items-center ${last ? "" : "mb-3"}`}>
      <Ionicons name={icon as any} size={20} color={colors.success} />
      <Text className="text-success font-semibold text-sm ml-3 flex-1">{label}</Text>
    </View>
  );
}

function QuickAction({
  icon,
  label,
  onPress,
  disabled,
  destructive,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      className={`flex-1 items-center rounded-xl py-3 ${disabled ? "opacity-30" : ""} bg-card`}
    >
      <Ionicons name={icon as any} size={20} color={destructive ? colors.error : colors.brand.DEFAULT} />
      <Text
        className={`text-[11px] font-medium mt-1 text-center ${destructive ? "text-error" : "text-text-secondary"}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
