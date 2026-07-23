import React, { useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import StarRating from "../../../components/ui/StarRating";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../components/ui/OutlinedButton";
import GenericConfirmationModal from "../../../components/modals/GenericConfirmationModal";
import { useWorkerStore } from "../../../store/workerStore";
import { workerActiveJobs } from "../../../constants/dummyData";
import { colors } from "../../../constants";
import StatusBadge from "../../../components/ui/StatusBadge";

export default function RequestDetailScreen() {
  const router = useRouter();
  const { requestId } = useLocalSearchParams<{ requestId: string }>();
  const updateRequestStatus = useWorkerStore((s) => s.updateRequestStatus);
  const request = useWorkerStore((s) =>
    s.jobRequests.find((r) => r.id === requestId),
  );
  const [declineVisible, setDeclineVisible] = useState(false);

  if (!request) {
    return (
      <SafeAreaView className="flex-1 bg-primary-white">
        <ScreenHeader title="Job Request" showBack />
        <View className="flex-1 items-center justify-center">
          <Text className="text-text-secondary">Not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const handleAccept = () => {
    updateRequestStatus(request.id, "Accepted");
    require("react-native").Alert.alert(
      "Job Accepted!",
      "The client has been notified. You can track the job from the job detail screen.",
      [
        {
          text: "View Job",
          onPress: () => router.replace(`/(worker)/requests/job/${request.id}`),
        },
        { text: "Go Back", onPress: () => router.back() },
      ],
    );
  };

  const handleDeclineConfirm = () => {
    setDeclineVisible(false);
    updateRequestStatus(request.id, "Declined");
    require("react-native").Alert.alert(
      "Declined",
      "The job request has been declined.",
    );
    router.back();
  };

  return (
    <SafeAreaView className="flex-1 bg-primary-white">
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
            <Text className="text-primary font-bold text-lg">
              {request.client}
            </Text>
            <StarRating rating={4.5} size={14} />
            <Text className="text-text-muted text-xs">8 reviews</Text>
            <View className="bg-success/20 rounded-full px-2 py-0.5 self-start mt-1">
              <Text className="text-success text-xs">Verified Client</Text>
            </View>
          </View>
        </View>

        {/* Service details */}
        <View className="bg-card rounded-2xl p-4 mb-3">
          <Text className="text-primary font-bold mb-2">Service</Text>
          <Text className="text-text-secondary text-sm">{request.service}</Text>
          <Text className="text-text-muted text-xs mt-2">
            Date: {request.date} · Estimated duration: 2 hrs
          </Text>
        </View>

        {/* Workload warning */}
        <View className="bg-card rounded-2xl p-4 mb-3">
          <Text className="text-primary font-bold mb-2">
            Your Current Workload
          </Text>
          {(() => {
            const activeJobs = workerActiveJobs["w1"] || 0;
            if (activeJobs === 0) {
              return (
                <Text className="text-success text-sm">
                  You have no active jobs. You are free to accept.
                </Text>
              );
            } else if (activeJobs === 1) {
              return (
                <Text className="text-warning text-sm">
                  You have 1 active job currently.
                </Text>
              );
            } else {
              return (
                <Text className="text-error text-sm">
                  You have {activeJobs} active jobs. Consider your capacity
                  before accepting.
                </Text>
              );
            }
          })()}
        </View>

        <View className="bg-card rounded-2xl p-4 mb-3">
          <Text className="text-primary font-bold mb-2">Status</Text>
          <StatusBadge status={request.status as any} />
        </View>

        {/* Location */}
        <View className="bg-card rounded-2xl p-4 mb-3">
          <Text className="text-primary font-bold mb-2">Location</Text>
          <Text className="text-text-secondary text-sm">
            123 Rizal St., Hagonoy, Bulacan
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
            ₱{request.amount}.00
          </Text>
          <View className="mt-3 bg-card-dark rounded-xl p-3 w-full">
            <Text className="text-text-secondary text-xs font-semibold mb-2">
              Your Earnings Breakdown
            </Text>
            <View className="flex-row justify-between py-1">
              <Text className="text-text-muted text-xs">Client Pays</Text>
              <Text className="text-text-secondary text-xs">
                ₱{request.amount}.00
              </Text>
            </View>
            <View className="flex-row justify-between py-1">
              <Text className="text-text-muted text-xs">
                Platform Fee (10%)
              </Text>
              <Text className="text-text-secondary text-xs">
                -₱{parseFloat((request.amount * 0.1).toFixed(2))}
              </Text>
            </View>
            <View className="border-b border-divider my-1" />
            <View className="flex-row justify-between py-1">
              <Text className="text-text-muted text-xs">You Receive</Text>
              <Text className="text-success text-xs font-bold">
                ₱{parseFloat((request.amount * 0.9).toFixed(2))}
              </Text>
            </View>
          </View>
        </View>

        {/* Action buttons */}
        {request.status === "Pending" ? (
          <View className="flex-row gap-3 mt-4">
            <OutlinedButton
              label="Decline"
              onPress={() => setDeclineVisible(true)}
            />
            <View className="flex-1">
              <PrimaryButton
                label="Accept Job"
                fullWidth
                onPress={handleAccept}
              />
            </View>
          </View>
        ) : (
          <View className="bg-card rounded-2xl p-4 mt-4">
            <Text className="text-primary font-bold mb-2">Request Status</Text>
            <Text className="text-text-secondary text-sm">
              This job request is {request.status.toLowerCase()}.
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
