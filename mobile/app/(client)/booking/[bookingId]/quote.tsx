import React, { useState } from "react";
import { View, Text, ScrollView, Alert, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import InputField from "../../../../components/ui/InputField";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import DangerButton from "../../../../components/ui/DangerButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import { useBookingStore } from "../../../../store/bookingStore";
import { approveQuote as apiApproveQuote, disputeQuote as apiDisputeQuote } from "../../../../services/api";
import { colors } from "../../../../constants";

export default function QuoteReviewScreen() {
  const router = useRouter();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const { bookings, approveQuote, disputeQuote } = useBookingStore();

  const booking = bookings.find((b) => b.id === bookingId);
  const quote = booking?.quote;

  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [loading, setLoading] = useState(false);

  if (!booking || !quote) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Review Quote" showBack />
        <View className="flex-1 items-center justify-center">
          <Ionicons
            name="document-outline"
            size={48}
            color={colors.text.muted}
          />
          <Text className="text-text-secondary mt-2">Quote not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isAlreadyActedOn =
    booking.status === "QuoteApproved" || booking.status === "Disputed";

  const handleApprove = async () => {
    Alert.alert(
      "Approve Quote?",
      `You are agreeing to pay ₱${quote.totalAmount.toFixed(2)} upon service completion.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Approve",
          onPress: async () => {
            setLoading(true);
            try {
              await apiApproveQuote(booking.id);
              approveQuote(booking.id);
              Alert.alert(
                "Quote Approved",
                "The worker has been notified. They will proceed with the service.",
                [
                  {
                    text: "OK",
                    onPress: () => router.back(),
                  },
                ],
              );
            } catch (error) {
              console.error("Approve quote error:", error);
              Alert.alert("Error", "Failed to approve quote. Please try again.");
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
  };

  const handleDispute = async () => {
    if (!disputeReason.trim()) {
      Alert.alert("Error", "Please describe why you are disputing this quote.");
      return;
    }
    setLoading(true);
    try {
      await apiDisputeQuote(booking.id, disputeReason);
      disputeQuote(booking.id, disputeReason);
      Alert.alert(
        "Dispute Submitted",
        "Our support team will review the quote and contact both parties.",
        [{ text: "OK", onPress: () => router.back() }],
      );
    } catch (error) {
      console.error("Dispute quote error:", error);
      Alert.alert("Error", "Failed to submit dispute. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Review Quote" showBack />
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
        {/* Booking summary */}
        <View className="bg-card rounded-2xl p-4 mb-4">
          <Text className="text-text-secondary text-xs mb-1">Booking</Text>
          <Text className="text-text-primary font-bold">{booking.service}</Text>
          <Text className="text-text-secondary text-sm mt-1">
            Worker: {booking.worker}
          </Text>
        </View>

        {/* Status banner for already acted quotes */}
        {isAlreadyActedOn && (
          <View
            className={`rounded-xl p-4 flex-row items-center mb-4 ${
              booking.status === "QuoteApproved"
                ? "bg-success/10 border border-success/30"
                : "bg-warning/10 border border-warning/30"
            }`}
          >
            <Ionicons
              name={
                booking.status === "QuoteApproved"
                  ? "checkmark-circle"
                  : "alert-circle"
              }
              size={20}
              color={
                booking.status === "QuoteApproved"
                  ? colors.success
                  : colors.warning
              }
            />
            <Text
              className={`ml-2 font-semibold text-sm ${
                booking.status === "QuoteApproved"
                  ? "text-success"
                  : "text-warning"
              }`}
            >
              {booking.status === "QuoteApproved"
                ? "You approved this quote"
                : "You disputed this quote"}
            </Text>
          </View>
        )}

        {/* Quote card */}
        <View className="bg-card rounded-2xl p-4 mb-4">
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-text-primary font-bold text-base">
              Worker&apos;s Quote
            </Text>
            <Text className="text-text-muted text-xs">
              {new Date(quote.submittedAt).toLocaleDateString("en-PH", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>
          </View>

          <View className="flex-row justify-between py-2 border-b border-divider">
            <Text className="text-text-secondary text-sm">Labor</Text>
            <Text className="text-brand font-semibold">
              ₱{quote.laborCost.toFixed(2)}
            </Text>
          </View>

          {quote.materialsCost > 0 && (
            <View className="flex-row justify-between py-2 border-b border-divider">
              <Text className="text-text-secondary text-sm">Materials</Text>
              <Text className="text-brand font-semibold">
                ₱{quote.materialsCost.toFixed(2)}
              </Text>
            </View>
          )}

          <View className="flex-row justify-between py-3">
            <Text className="text-text-primary font-bold">Total</Text>
            <Text className="text-accent font-bold text-xl">
              ₱{quote.totalAmount.toFixed(2)}
            </Text>
          </View>

          {quote.notes ? (
            <View className="bg-card-light rounded-xl p-3 mt-2">
              <Text className="text-text-secondary text-xs font-semibold mb-1">
                Worker&apos;s notes
              </Text>
              <Text className="text-brand text-sm">{quote.notes}</Text>
            </View>
          ) : null}
        </View>

        {/* Info note */}
        {!isAlreadyActedOn && (
          <View className="bg-blue-50 rounded-xl p-4 flex-row items-start mb-6">
            <Ionicons
              name="information-circle-outline"
              size={18}
              color={colors.brand.DEFAULT}
            />
            <Text className="text-text-secondary text-xs ml-2 flex-1">
              Payment will only be processed after you approve this quote and
              the service is completed.
            </Text>
          </View>
        )}

        {/* Dispute form */}
        {showDisputeForm && (
          <View className="mb-4">
            <InputField
              label="Reason for dispute"
              value={disputeReason}
              onChangeText={setDisputeReason}
              placeholder="Explain why you disagree with this quote..."
              multiline
            />
          </View>
        )}

        {/* Action buttons */}
        {!isAlreadyActedOn && (
          <View className="gap-3">
            {!showDisputeForm ? (
              <>
                <PrimaryButton
                  label={`Approve ₱${quote.totalAmount.toFixed(2)}`}
                  fullWidth
                  loading={loading}
                  onPress={handleApprove}
                />
                <Pressable
                  className="border-2 border-warning rounded-xl py-4 items-center"
                  onPress={() => setShowDisputeForm(true)}
                >
                  <Text className="text-warning font-semibold">
                    Dispute Quote
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                <DangerButton
                  label="Submit Dispute"
                  fullWidth
                  disabled={!disputeReason.trim() || loading}
                  onPress={handleDispute}
                />
                <OutlinedButton
                  label="Cancel"
                  onPress={() => {
                    setShowDisputeForm(false);
                    setDisputeReason("");
                  }}
                />
              </>
            )}
          </View>
        )}

        {isAlreadyActedOn && (
          <OutlinedButton label="Go Back" onPress={() => router.back()} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
