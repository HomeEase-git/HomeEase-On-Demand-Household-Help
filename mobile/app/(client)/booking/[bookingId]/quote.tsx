import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import InputField from "../../../../components/ui/InputField";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import DangerButton from "../../../../components/ui/DangerButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import { useBookingStore, API_STATUS_MAP, type Booking } from "../../../../store/bookingStore";
import {
  approveQuote as apiApproveQuote,
  disputeQuote as apiDisputeQuote,
  getBookingDetail,
} from "../../../../services/api";
import { colors } from "../../../../constants";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

// Matches the shape of GET /bookings/:id — this screen needs to hydrate the
// store itself when opened directly (e.g. a push notification deep link)
// without [bookingId]/index.tsx loading first (see mapApiBookingDetail there
// for the fuller version; this one only needs the quote-relevant fields).
function mapDetailToBooking(d: any): Booking {
  return {
    id: d.id,
    service: d.service,
    worker: d.worker?.fullName ?? "Unassigned",
    date: d.scheduledDate,
    status: API_STATUS_MAP[d.status] ?? "Pending",
    amount: d.finalPrice ?? d.estimatedPrice,
    quote: d.quote
      ? {
          laborCost: d.quote.laborCost,
          materialsCost: d.quote.materialsCost,
          totalAmount: d.finalPrice ?? 0,
          notes: d.quote.notes ?? "",
          submittedAt: d.quote.quotedAt ?? d.scheduledDate,
        }
      : undefined,
  };
}

export default function QuoteReviewScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const { bookings, approveQuote, disputeQuote } = useBookingStore();

  const booking = bookings.find((b) => b.id === bookingId);
  const quote = booking?.quote;

  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingBooking, setCheckingBooking] = useState(!booking);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (booking || !bookingId) return;
    let cancelled = false;
    (async () => {
      try {
        const detail = await getBookingDetail(bookingId);
        if (cancelled) return;
        const mapped = mapDetailToBooking(detail);
        useBookingStore.setState((s) => ({
          bookings: [...s.bookings.filter((b) => b.id !== mapped.id), mapped],
        }));
      } catch (error) {
        console.error("Load booking for quote review error:", error);
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setCheckingBooking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [booking, bookingId]);

  if (checkingBooking) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Review Quote" showBack />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="small" color={colors.accent.DEFAULT} />
        </View>
      </SafeAreaView>
    );
  }

  if (!booking || !quote || notFound) {
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
    alertModal.confirm(
      "Approve Quote?",
      `You are agreeing to pay ₱${quote.totalAmount.toFixed(2)} upon service completion.`,
      {
        confirmText: "Approve",
        cancelText: "Cancel",
        onConfirm: async () => {
          setLoading(true);
          try {
            await apiApproveQuote(booking.id);
            approveQuote(booking.id);
            alertModal.success(
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
            alertModal.error("Error", "Failed to approve quote. Please try again.");
          } finally {
            setLoading(false);
          }
        },
      },
    );
  };

  const handleDispute = async () => {
    if (!disputeReason.trim()) {
      alertModal.error("Error", "Please describe why you are disputing this quote.");
      return;
    }
    setLoading(true);
    try {
      await apiDisputeQuote(booking.id, disputeReason);
      disputeQuote(booking.id, disputeReason);
      alertModal.success(
        "Dispute Submitted",
        "Our support team will review the quote and contact both parties.",
        [{ text: "OK", onPress: () => router.back() }],
      );
    } catch (error) {
      console.error("Dispute quote error:", error);
      alertModal.error("Error", "Failed to submit dispute. Please try again.");
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
            <Text className="text-text-secondary text-sm">
              Labor (agreed at booking)
            </Text>
            <Text className="text-primary font-semibold">
              ₱{quote.laborCost.toFixed(2)}
            </Text>
          </View>

          {quote.materialsCost > 0 && (
            <View className="flex-row justify-between py-2 border-b border-divider">
              <Text className="text-text-secondary text-sm">
                Additional Costs
              </Text>
              <Text className="text-primary font-semibold">
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
              <Text className="text-primary text-sm">{quote.notes}</Text>
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
