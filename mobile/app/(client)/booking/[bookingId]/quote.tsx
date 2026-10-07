import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { ScreenSkeleton } from "../../../../components/feedback/ScreenSkeleton";
import { RemoteImage } from "../../../../components/ui/RemoteImage";
import { KeyboardAwareScrollView } from "../../../../components/ui/KeyboardAwareScrollView";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import InputField from "../../../../components/ui/InputField";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import DangerButton from "../../../../components/ui/DangerButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import ImageSourcePickerBottomSheet from "../../../../components/bottom-sheets/ImageSourcePickerBottomSheet";
import type { BottomSheetHandle } from "../../../../components/bottom-sheets/BottomSheetWrapper";
import {
  useBookingStore,
  API_STATUS_MAP,
  type Booking,
} from "../../../../store/bookingStore";
import {
  approveQuote as apiApproveQuote,
  disputeQuote as apiDisputeQuote,
  rejectQuote as apiRejectQuote,
  uploadIssuePhoto,
  getBookingDetail,
} from "../../../../services/api";
import { colors } from "../../../../constants";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

const MAX_EVIDENCE_PHOTOS = 5;

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
  const [showRefuseForm, setShowRefuseForm] = useState(false);
  const [refuseReason, setRefuseReason] = useState("");
  // Items and their receipt / in-use photos (not kept in the store). Legacy
  // quotes have no items, only the two aggregate photo lists.
  const [proof, setProof] = useState<{
    items: { name: string; price: number; receiptUrls: string[]; proofOfUseUrls: string[] }[];
    receiptUrls: string[];
    proofOfUseUrls: string[];
    revision: number;
  }>({
    items: [],
    receiptUrls: [],
    proofOfUseUrls: [],
    revision: 0,
  });
  const [disputeReason, setDisputeReason] = useState("");
  const [evidencePhotos, setEvidencePhotos] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoSheetRef = useRef<BottomSheetHandle | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingBooking, setCheckingBooking] = useState(!booking);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!bookingId) return;
    let cancelled = false;
    (async () => {
      try {
        const detail = await getBookingDetail(bookingId);
        if (cancelled) return;
        setProof({
          items: detail?.quote?.items ?? [],
          receiptUrls: detail?.quote?.receiptUrls ?? [],
          proofOfUseUrls: detail?.quote?.proofOfUseUrls ?? [],
          revision: detail?.quote?.revision ?? 0,
        });
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
  }, [bookingId]);

  const proofGroups =
    proof.items.length > 0
      ? proof.items.flatMap((i) => [
          { title: `${i.name} — receipt`, urls: i.receiptUrls },
          { title: `${i.name} — in use`, urls: i.proofOfUseUrls },
        ])
      : [
          { title: "Receipts", urls: proof.receiptUrls },
          { title: "Materials in use", urls: proof.proofOfUseUrls },
        ];

  if (checkingBooking) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Review Quote" showBack />
        <ScreenSkeleton />
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
      `You are agreeing to pay ₱${quote.totalAmount.toFixed(2)} upon service completion.${
        quote.materialsCost > 0 ? " Make sure the materials price matches the receipt." : ""
      }`,
      {
        confirmText: "Approve",
        cancelText: "Cancel",
        onConfirm: async () => {
          setLoading(true);
          try {
            await apiApproveQuote(booking.id, proof.revision);
            approveQuote(booking.id);
            alertModal.success(
              "Quote Approved",
              "The worker has been notified and will proceed.",
              [
                {
                  text: "OK",
                  onPress: () => router.back(),
                },
              ],
            );
          } catch (error: any) {
            console.error("Approve quote error:", error);
            alertModal.error(
              "Error",
              error?.message || "Failed to approve quote. Please try again.",
            );
          } finally {
            setLoading(false);
          }
        },
      },
    );
  };

  const handlePickEvidencePhoto = async (uri: string) => {
    if (evidencePhotos.length >= MAX_EVIDENCE_PHOTOS) return;
    setUploadingPhoto(true);
    try {
      const { url } = await uploadIssuePhoto(uri);
      setEvidencePhotos((prev) => [...prev, url]);
    } catch {
      alertModal.error(
        "Upload failed",
        "Could not upload that photo. Please try again.",
      );
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleRemoveEvidencePhoto = (url: string) => {
    setEvidencePhotos((prev) => prev.filter((u) => u !== url));
  };

  // Refusing sends the quote back to the worker to fix (e.g. the price
  // doesn't match the receipt). Disputing asks HomeEase to step in instead.
  const handleRefuse = async () => {
    if (refuseReason.trim().length < 5) {
      alertModal.error("Error", "Tell your pro what's wrong with the quote.");
      return;
    }
    setLoading(true);
    try {
      await apiRejectQuote(booking.id, refuseReason.trim());
      useBookingStore.setState((s) => ({
        bookings: s.bookings.map((b) => (b.id === booking.id ? { ...b, status: "InProgress" as const, quote: undefined } : b)),
      }));
      alertModal.success("Quote Refused", "Your pro will revise the quote and send it again.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (error: any) {
      console.error("Refuse quote error:", error);
      alertModal.error("Error", error?.message || "Failed to refuse the quote. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleDispute = async () => {
    if (!disputeReason.trim()) {
      alertModal.error(
        "Error",
        "Please describe why you are disputing this quote.",
      );
      return;
    }
    setLoading(true);
    try {
      await apiDisputeQuote(booking.id, disputeReason, evidencePhotos);
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
      <KeyboardAwareScrollView
        contentContainerStyle={{ padding: 24, paddingBottom: 40 }}
      >
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
              Service (agreed at booking)
            </Text>
            <Text className="text-text-primary font-semibold">
              ₱{quote.laborCost.toFixed(2)}
            </Text>
          </View>

          {proof.items.length > 0
            ? proof.items.map((item, index) => (
                <View key={`${index}-${item.name}`} className="flex-row justify-between py-2 border-b border-divider">
                  <Text className="text-text-secondary text-sm flex-1 pr-2">{item.name}</Text>
                  <Text className="text-text-primary font-semibold">₱{item.price.toFixed(2)}</Text>
                </View>
              ))
            : quote.materialsCost > 0 && (
                <View className="flex-row justify-between py-2 border-b border-divider">
                  <Text className="text-text-secondary text-sm">Materials</Text>
                  <Text className="text-text-primary font-semibold">₱{quote.materialsCost.toFixed(2)}</Text>
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
              <Text className="text-text-primary text-sm">{quote.notes}</Text>
            </View>
          ) : null}
          {proof.revision > 0 && (
            <Text className="text-text-muted text-xs mt-2">Revised quote (version {proof.revision + 1})</Text>
          )}
        </View>

        {/* Proof of purchase and use — check the materials price against the receipt */}
        {proofGroups.some((g) => g.urls.length > 0) && (
          <View className="bg-card rounded-2xl p-4 mb-4">
            <Text className="text-text-primary font-bold text-base mb-1">Proof</Text>
            <Text className="text-text-muted text-xs mb-3">
              Check that each price matches its receipt. If it doesn&apos;t, refuse the quote.
            </Text>
            {proofGroups.map((group, index) =>
              group.urls.length > 0 ? (
                <View key={`${index}-${group.title}`} className="mb-3">
                  <Text className="text-text-secondary text-xs font-semibold mb-1.5">{group.title}</Text>
                  <View className="flex-row flex-wrap gap-2">
                    {group.urls.map((url) => (
                      <Pressable
                        key={url}
                        accessibilityRole="imagebutton"
                        accessibilityLabel={`Open ${group.title.toLowerCase()} photo`}
                        onPress={() => router.push({ pathname: "/(client)/inbox/image-viewer", params: { imageUrl: url } })}
                      >
                        <RemoteImage source={{ uri: url }} style={{ width: 88, height: 88, borderRadius: 12 }} resizeMode="cover" />
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null,
            )}
          </View>
        )}

        {/* Info note */}
        {!isAlreadyActedOn && (
          <View className="bg-blue-50 rounded-xl p-4 flex-row items-start mb-6">
            <Ionicons
              name="information-circle-outline"
              size={18}
              color={colors.brand.DEFAULT}
            />
            <Text className="text-text-secondary text-xs ml-2 flex-1">
              You&apos;ll only be charged after the job is done.
            </Text>
          </View>
        )}

        {/* Refuse form */}
        {showRefuseForm && (
          <View className="mb-4">
            <InputField
              label="What's wrong with the quote?"
              value={refuseReason}
              onChangeText={setRefuseReason}
              placeholder="e.g. The receipt says ₱300 but the quote says ₱350"
              multiline
            />
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

            <Text className="text-text-secondary font-bold text-sm mb-1 mt-4">
              Evidence photos (optional)
            </Text>
            <View className="flex-row flex-wrap gap-2 mt-1">
              {evidencePhotos.map((url) => (
                <View key={url} className="relative">
                  <RemoteImage
                    source={{ uri: url }}
                    className="w-20 h-20 rounded-xl"
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Remove photo"
                    hitSlop={8}
                    className="absolute -top-1.5 -right-1.5 bg-black/70 rounded-full w-5 h-5 items-center justify-center"
                    onPress={() => handleRemoveEvidencePhoto(url)}
                  >
                    <Ionicons name="close" size={12} color="#fff" />
                  </Pressable>
                </View>
              ))}
              {evidencePhotos.length < MAX_EVIDENCE_PHOTOS && (
                <Pressable
                  className="w-20 h-20 rounded-xl border border-dashed items-center justify-center"
                  style={{ borderColor: colors.divider }}
                  onPress={() => photoSheetRef.current?.expand()}
                  disabled={uploadingPhoto}
                >
                  {uploadingPhoto ? (
                    <ActivityIndicator size="small" />
                  ) : (
                    <>
                      <Ionicons
                        name="camera-outline"
                        size={20}
                        color={colors.text.muted}
                      />
                      <Text className="text-text-secondary text-xs mt-1">
                        Add photo
                      </Text>
                    </>
                  )}
                </Pressable>
              )}
            </View>
          </View>
        )}

        {/* Action buttons */}
        {!isAlreadyActedOn && (
          <View className="gap-3">
            {showRefuseForm ? (
              <>
                <DangerButton
                  label="Refuse Quote"
                  fullWidth
                  loading={loading}
                  disabled={refuseReason.trim().length < 5 || loading}
                  onPress={handleRefuse}
                />
                <OutlinedButton
                  label="Cancel"
                  onPress={() => {
                    setShowRefuseForm(false);
                    setRefuseReason("");
                  }}
                />
              </>
            ) : !showDisputeForm ? (
              <>
                <PrimaryButton
                  label={`Approve ₱${quote.totalAmount.toFixed(2)}`}
                  fullWidth
                  loading={loading}
                  onPress={handleApprove}
                />
                <OutlinedButton label="Refuse & Ask for a Revision" onPress={() => setShowRefuseForm(true)} />
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
                  loading={loading}
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
      </KeyboardAwareScrollView>
      <ImageSourcePickerBottomSheet
        innerRef={photoSheetRef}
        onSelect={handlePickEvidencePhoto}
      />
    </SafeAreaView>
  );
}
