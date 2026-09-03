import React, { useCallback, useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { isAxiosError } from "axios";
import { useFocusEffect, useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import Avatar from "../../../components/ui/Avatar";
import AddressMap from "../../../components/ui/AddressMap";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../components/ui/OutlinedButton";
import DeclineReasonModal from "../../../components/modals/DeclineReasonModal";
import { Skeleton } from "../../../components/ui/Skeleton";
import { useWorkerStore } from "../../../store/workerStore";
import { API_STATUS_MAP } from "../../../store/bookingStore";
import * as api from "../../../services/api";
import { colors } from "../../../constants";
import StatusBadge from "../../../components/ui/StatusBadge";
import { useAlertModal } from "../../../contexts/AlertModalContext";
import { summarizeFlatRoomTypes } from "../../../utils/bookingPriceEstimate";
import { ROOM_TYPE_LABELS, CONDITION_LABELS, type RoomType, type ConditionType } from "../../../types/booking4step.types";

type BookingDetail = {
  id: string;
  client: { id: string; fullName: string; phone: string | null; avatar?: string | null };
  service: string;
  status: string;
  location: string | null;
  scheduledDate: string;
  estimatedPrice: number;
  rooms?: RoomType[];
  condition?: ConditionType | null;
  scopeAnswers?: Record<string, string | string[]> | null;
  distanceMeters?: number | null;
  payment?: { commissionAmount?: number; workerPayout?: number } | null;
};

export default function RequestDetailScreen() {
  const router = useRouter();
  const { requestId } = useLocalSearchParams<{ requestId: string }>();
  const updateJobStatus = useWorkerStore((s) => s.updateJobStatus);
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [capacity, setCapacity] = useState<{ activeJobCount: number; maxConcurrentJobs: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [declineVisible, setDeclineVisible] = useState(false);
  const alertModal = useAlertModal();

  const load = useCallback(async () => {
    if (!requestId) return;
    setLoading(true);
    try {
      const [detail, cap] = await Promise.all([
        api.getBookingDetail(requestId),
        api.getWorkerCapacity(),
      ]);
      setBooking(detail);
      setCapacity(cap);
    } catch (error) {
      console.error("Load request detail error:", error);
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Job Request" showBack />
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <View className="bg-card rounded-2xl p-4 mb-3 flex-row items-center">
            <Skeleton width={56} height={56} borderRadius={28} marginBottom={0} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Skeleton width="60%" height={16} marginBottom={6} />
              <Skeleton width="40%" height={12} marginBottom={0} />
            </View>
          </View>
          <View className="bg-card rounded-2xl p-4 mb-3">
            <Skeleton width="30%" height={14} marginBottom={8} />
            <Skeleton width="80%" height={12} marginBottom={6} />
            <Skeleton width="50%" height={10} marginBottom={0} />
          </View>
          <View className="bg-card rounded-2xl p-4 mb-3 items-center">
            <Skeleton width="40%" height={12} marginBottom={8} />
            <Skeleton width="50%" height={32} marginBottom={0} />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!booking) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Job Request" showBack />
        <View className="flex-1 items-center justify-center">
          <Text className="text-text-secondary">Not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const status = API_STATUS_MAP[booking.status] ?? "Pending";
  const activeJobs = capacity?.activeJobCount ?? 0;

  const handleAccept = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await api.acceptBooking(booking.id);
      updateJobStatus(booking.id, "Accepted");
      alertModal.success(
        "Job Accepted!",
        "The client has been notified. You can track the job from the job detail screen.",
        [
          {
            text: "View Job",
            onPress: () => router.replace(`/(worker)/requests/job/${booking.id}`),
          },
          { text: "Go Back", onPress: () => router.back() },
        ],
      );
    } catch (error) {
      console.error("Accept booking error:", error);
      if (isAxiosError(error) && error.response?.status === 402) {
        alertModal.error(
          "Account on Hold",
          error.message || "Your account is on hold. Please contact support to continue accepting jobs.",
          [
            { text: "Contact Support", onPress: () => router.push("/(worker)/profile/help-support") },
            { text: "Cancel" },
          ],
        );
      } else {
        alertModal.error("Error", "Failed to accept this job. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeclineConfirm = async (reason: string) => {
    setSubmitting(true);
    try {
      await api.declineBooking(booking.id, reason);
      setDeclineVisible(false);
      alertModal.success("Declined", "The job request has been declined.");
      router.back();
    } catch (error) {
      console.error("Decline booking error:", error);
      alertModal.error("Error", "Failed to decline this job. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Job Request" showBack />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
        {/* Client info */}
        <View className="bg-card rounded-2xl p-4 mb-3 flex-row items-center">
          <View className="mr-3">
            <Avatar uri={booking.client.avatar} size="lg" />
          </View>
          <View className="flex-1">
            <Text className="text-text-primary font-bold text-lg">
              {booking.client.fullName}
            </Text>
            {booking.client.phone ? (
              <Text className="text-text-secondary text-xs mt-1">
                {booking.client.phone}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Service details */}
        <View className="bg-card rounded-2xl p-4 mb-3">
          <Text className="text-text-primary font-bold mb-2">Service</Text>
          <Text className="text-text-secondary text-sm">{booking.service}</Text>
          <Text className="text-text-muted text-xs mt-2">
            Date: {booking.scheduledDate}
          </Text>
          {!!booking.rooms?.length && (
            <View className="flex-row items-center mt-2">
              <Ionicons name="home-outline" size={14} color={colors.text.muted} />
              <Text className="text-text-secondary text-xs ml-1.5">
                {summarizeFlatRoomTypes(booking.rooms, ROOM_TYPE_LABELS)}
              </Text>
            </View>
          )}
          {booking.condition && (
            <View className="flex-row items-center mt-1.5">
              <Ionicons name="sparkles-outline" size={14} color={colors.text.muted} />
              <Text className="text-text-secondary text-xs ml-1.5">
                {CONDITION_LABELS[booking.condition]} condition
              </Text>
            </View>
          )}
          {!!booking.scopeAnswers && Object.keys(booking.scopeAnswers).length > 0 && (
            <View className="mt-1.5">
              {Object.entries(booking.scopeAnswers).map(([label, value]) => (
                <View key={label} className="flex-row items-center mt-1">
                  <Ionicons name="construct-outline" size={14} color={colors.text.muted} />
                  <Text className="text-text-secondary text-xs ml-1.5">
                    {label}: {Array.isArray(value) ? value.join(", ") : value}
                  </Text>
                </View>
              ))}
            </View>
          )}
          {booking.distanceMeters != null && (
            <View className="flex-row items-center mt-1.5">
              <Ionicons name="navigate-outline" size={14} color={colors.text.muted} />
              <Text className="text-text-secondary text-xs ml-1.5">
                {(booking.distanceMeters / 1000).toFixed(1)} km away
              </Text>
            </View>
          )}
        </View>

        {/* Workload warning */}
        {capacity && (
          <View className="bg-card rounded-2xl p-4 mb-3">
            <Text className="text-text-primary font-bold mb-2">
              Your Current Workload
            </Text>
            {activeJobs === 0 ? (
              <Text className="text-success text-sm">
                You have no active jobs. You are free to accept.
              </Text>
            ) : activeJobs >= capacity.maxConcurrentJobs ? (
              <Text className="text-error text-sm">
                You have {activeJobs} active jobs and are at capacity.
              </Text>
            ) : (
              <Text className="text-warning text-sm">
                You have {activeJobs} active job{activeJobs > 1 ? "s" : ""} currently.
              </Text>
            )}
          </View>
        )}

        <View className="bg-card rounded-2xl p-4 mb-3">
          <Text className="text-text-primary font-bold mb-2">Status</Text>
          <StatusBadge status={status as any} />
        </View>

        {/* Location */}
        <View className="bg-card rounded-2xl p-4 mb-3">
          <Text className="text-text-primary font-bold mb-2">Location</Text>
          <Text className="text-text-secondary text-sm">
            {booking.location || "No address provided"}
          </Text>
          <View className="mt-3">
            <AddressMap height="h-32" address={booking.location} />
          </View>
        </View>

        {/* Earnings breakdown */}
        <View className="bg-card rounded-2xl p-4 mb-3 items-center">
          <Text className="text-text-secondary text-sm">Offered Price</Text>
          <Text className="text-accent font-bold text-4xl mt-1">
            ₱{booking.estimatedPrice}.00
          </Text>
          <View className="mt-3 bg-card-dark rounded-xl p-3 w-full">
            <Text className="text-text-secondary text-xs font-semibold mb-2">
              Your Earnings Breakdown
            </Text>
            <View className="flex-row justify-between py-1">
              <Text className="text-text-muted text-xs">Client Pays</Text>
              <Text className="text-text-secondary text-xs">
                ₱{booking.estimatedPrice}.00
              </Text>
            </View>
            <View className="flex-row justify-between py-1">
              <Text className="text-text-muted text-xs">
                Platform Fee & Tax
              </Text>
              <Text className="text-text-secondary text-xs">
                -₱{(booking.payment?.commissionAmount ?? booking.estimatedPrice * 0.1).toFixed(2)}
              </Text>
            </View>
            <View className="border-b border-divider my-1" />
            <View className="flex-row justify-between py-1">
              <Text className="text-text-muted text-xs">You Receive</Text>
              <Text className="text-success text-xs font-bold">
                ₱{(booking.payment?.workerPayout ?? booking.estimatedPrice * 0.9).toFixed(2)}
              </Text>
            </View>
          </View>
        </View>

        {/* Action buttons */}
        {status === "Pending" ? (
          <View className="flex-row gap-3 mt-4">
            <OutlinedButton
              label="Decline"
              onPress={() => setDeclineVisible(true)}
              disabled={submitting}
            />
            <View className="flex-1">
              <PrimaryButton
                label="Accept Job"
                fullWidth
                onPress={handleAccept}
                disabled={submitting}
                loading={submitting}
              />
            </View>
          </View>
        ) : (
          <View className="bg-card rounded-2xl p-4 mt-4">
            <Text className="text-text-primary font-bold mb-2">Request Status</Text>
            <Text className="text-text-secondary text-sm mb-3">
              This job request is {status.toLowerCase()}.
            </Text>
            {status !== "Cancelled" && (
              <PrimaryButton
                label="View Job"
                fullWidth
                onPress={() => router.push(`/(worker)/requests/job/${booking.id}`)}
              />
            )}
          </View>
        )}
      </ScrollView>

      <DeclineReasonModal
        visible={declineVisible}
        loading={submitting}
        onConfirm={handleDeclineConfirm}
        onCancel={() => setDeclineVisible(false)}
      />
    </SafeAreaView>
  );
}
