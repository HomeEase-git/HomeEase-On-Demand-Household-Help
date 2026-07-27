import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../components/ui/OutlinedButton";
import GenericConfirmationModal from "../../../components/modals/GenericConfirmationModal";
import { useWorkerStore } from "../../../store/workerStore";
import { API_STATUS_MAP } from "../../../store/bookingStore";
import * as api from "../../../services/api";
import { colors } from "../../../constants";
import StatusBadge from "../../../components/ui/StatusBadge";

type BookingDetail = {
  id: string;
  client: { id: string; fullName: string; phone: string | null };
  service: string;
  status: string;
  location: string | null;
  scheduledDate: string;
  estimatedPrice: number;
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
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="small" />
        </View>
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
      Alert.alert(
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
      Alert.alert("Error", "Failed to accept this job. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeclineConfirm = async () => {
    setDeclineVisible(false);
    setSubmitting(true);
    try {
      await api.declineBooking(booking.id);
      Alert.alert("Declined", "The job request has been declined.");
      router.back();
    } catch (error) {
      console.error("Decline booking error:", error);
      Alert.alert("Error", "Failed to decline this job. Please try again.");
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
          <View className="w-14 h-14 bg-card-light rounded-full items-center justify-center mr-3">
            <Ionicons
              name="person-circle"
              size={48}
              color={colors.text.muted}
            />
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
          <View className="w-full h-32 bg-card-dark rounded-xl mt-3 items-center justify-center">
            <Ionicons
              name="map-outline"
              size={40}
              color={colors.accent.DEFAULT}
            />
            <Text className="text-text-muted text-xs mt-1">Map Preview</Text>
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
                Platform Fee (10%)
              </Text>
              <Text className="text-text-secondary text-xs">
                -₱{parseFloat((booking.estimatedPrice * 0.1).toFixed(2))}
              </Text>
            </View>
            <View className="border-b border-divider my-1" />
            <View className="flex-row justify-between py-1">
              <Text className="text-text-muted text-xs">You Receive</Text>
              <Text className="text-success text-xs font-bold">
                ₱{parseFloat((booking.estimatedPrice * 0.9).toFixed(2))}
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
            <Text className="text-text-secondary text-sm">
              This job request is {status.toLowerCase()}.
            </Text>
          </View>
        )}
      </ScrollView>

      <GenericConfirmationModal
        visible={declineVisible}
        title="Decline this job?"
        message="Please confirm you want to decline this request."
        confirmLabel="Yes, Decline"
        cancelLabel="Keep It"
        onConfirm={handleDeclineConfirm}
        onCancel={() => setDeclineVisible(false)}
      />
    </SafeAreaView>
  );
}
