import React, { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { KeyboardAwareScrollView } from "../../../../components/ui/KeyboardAwareScrollView";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import InputField from "../../../../components/ui/InputField";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import { Skeleton } from "../../../../components/ui/Skeleton";
import * as api from "../../../../services/api";
import { colors } from "../../../../constants";
import { useAlertModal } from "../../../../contexts/AlertModalContext";
import ProofPhotosField from "../../../../components/booking/ProofPhotosField";

type BookingSummary = {
  id: string;
  service: string;
  scheduledDate: string;
  estimatedPrice: number;
  addOns?: { id: string; name: string; price: number }[];
  // A custom-quote job has no price until the worker quotes it.
  serviceTaskPricingModel?: string | null;
  quote?: {
    status?: string | null;
    rejectionReason?: string | null;
    materialsCost?: number;
    laborCost?: number;
    notes?: string | null;
    receiptUrls?: string[];
    proofOfUseUrls?: string[];
  } | null;
};

export default function SubmitQuoteScreen() {
  const router = useRouter();
  const { requestId } = useLocalSearchParams<{ requestId: string }>();
  const [booking, setBooking] = useState<BookingSummary | null>(null);
  const [fetching, setFetching] = useState(true);
  const alertModal = useAlertModal();

  useEffect(() => {
    let active = true;
    async function load() {
      if (!requestId) return;
      setFetching(true);
      try {
        const detail = await api.getBookingDetail(requestId);
        if (!active) return;
        setBooking(detail);
        // Revising a refused quote starts from what was sent before.
        if (detail?.quote?.status === "REJECTED") {
          setMaterialsCost(detail.quote.materialsCost ? String(detail.quote.materialsCost) : "");
          setNotes(detail.quote.notes ?? "");
          setReceiptUrls(detail.quote.receiptUrls ?? []);
          setProofOfUseUrls(detail.quote.proofOfUseUrls ?? []);
          if (detail.serviceTaskPricingModel === "CUSTOM_QUOTE" && detail.quote.laborCost) {
            setLaborInput(String(detail.quote.laborCost));
          }
        }
      } catch (error) {
        console.error("Load booking for quote error:", error);
      } finally {
        if (active) setFetching(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [requestId]);

  const [materialsCost, setMaterialsCost] = useState("");
  const [notes, setNotes] = useState("");
  const [laborInput, setLaborInput] = useState("");
  const [receiptUrls, setReceiptUrls] = useState<string[]>([]);
  const [proofOfUseUrls, setProofOfUseUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const isCustomQuote = booking?.serviceTaskPricingModel === "CUSTOM_QUOTE";
  const labor = isCustomQuote ? parseFloat(laborInput) || 0 : (booking?.estimatedPrice ?? 0);
  const addOns = booking?.addOns ?? [];
  const addOnsTotal = addOns.reduce((sum, a) => sum + a.price, 0);
  const materials = parseFloat(materialsCost) || 0;
  const total = labor + addOnsTotal + materials;
  // Materials must come with a receipt and a photo of them in use.
  const needsProof = materials > 0;
  const proofMissing = needsProof && (receiptUrls.length === 0 || proofOfUseUrls.length === 0);
  const canSubmit = !proofMissing && (!isCustomQuote || labor > 0);

  if (fetching) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Submit Quote" showBack />
        <KeyboardAwareScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
          <View className="bg-card rounded-2xl p-4 mb-6">
            <Skeleton width="25%" height={10} marginBottom={6} />
            <Skeleton width="60%" height={16} marginBottom={6} />
            <Skeleton width="40%" height={12} marginBottom={0} />
          </View>
          <Skeleton width="40%" height={16} marginBottom={16} />
          <Skeleton width="100%" height={48} borderRadius={12} marginBottom={16} />
          <Skeleton width="100%" height={48} borderRadius={12} marginBottom={16} />
          <Skeleton width="100%" height={80} borderRadius={12} marginBottom={0} />
        </KeyboardAwareScrollView>
      </SafeAreaView>
    );
  }

  if (!booking) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Submit Quote" showBack />
        <View className="flex-1 items-center justify-center">
          <Text className="text-text-secondary">Booking not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await api.submitQuote(booking.id, {
        materialsCost: materials,
        ...(isCustomQuote ? { laborCost: labor } : {}),
        notes: notes.trim(),
        receiptUrls: needsProof ? receiptUrls : [],
        proofOfUseUrls: needsProof ? proofOfUseUrls : [],
      });

      alertModal.success(
        "Quote Submitted",
        "The client has been notified and will check it against your receipt.",
        [{ text: "OK", onPress: () => router.back() }],
      );
    } catch (error: any) {
      console.error("Submit quote error:", error);
      alertModal.error("Error", error?.message || "Failed to submit your quote. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Submit Quote" showBack />
      <KeyboardAwareScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
        {/* Booking Summary */}
        <View className="bg-card rounded-2xl p-4 mb-6">
          <Text className="text-text-secondary text-xs mb-1">Booking</Text>
          <Text className="text-text-primary font-bold">{booking.service}</Text>
          <Text className="text-text-secondary text-sm mt-1">
            {booking.scheduledDate}
          </Text>
        </View>

        {/* Refused quote — the client's reason */}
        {booking.quote?.status === "REJECTED" && (
          <View className="bg-error/10 border border-error/30 rounded-xl p-4 mb-4">
            <Text className="text-error font-bold text-sm">The client refused your last quote</Text>
            {!!booking.quote.rejectionReason && (
              <Text className="text-text-secondary text-sm mt-1">&ldquo;{booking.quote.rejectionReason}&rdquo;</Text>
            )}
          </View>
        )}

        {/* Info Banner */}
        <View className="bg-accent/10 border border-accent/30 rounded-xl p-4 flex-row items-start mb-6">
          <Ionicons
            name="information-circle-outline"
            size={20}
            color={colors.accent.DEFAULT}
          />
          <Text className="text-text-secondary text-sm ml-2 flex-1">
            {isCustomQuote
              ? "This job is priced by your quote. Enter your price for the work and any materials."
              : "Your service is covered by the booking price. Add any materials below."}{" "}
            Materials need a photo of the receipt and a photo of them used on the job. The client can refuse a quote
            that doesn&apos;t match the receipt.
          </Text>
        </View>

        {/* Cost Inputs */}
        <Text className="text-text-primary font-bold mb-4">Cost Breakdown</Text>

        {isCustomQuote ? (
          <InputField
            label="Your price for the work (₱)"
            value={laborInput}
            onChangeText={setLaborInput}
            placeholder="e.g. 3500"
            keyboardType="numeric"
          />
        ) : (
          <View className="bg-card rounded-xl px-3 py-3 mb-4 flex-row justify-between items-center">
            <Text className="text-text-secondary text-sm">
              Service Cost (settled at booking)
            </Text>
            <Text className="text-text-primary font-semibold">
              ₱{labor.toFixed(2)}
            </Text>
          </View>
        )}

        {addOns.length > 0 && (
          <View className="bg-card rounded-xl px-3 py-3 mb-4">
            <Text className="text-text-secondary text-sm mb-2">
              Items already added on-site
            </Text>
            {addOns.map((item) => (
              <View key={item.id} className="flex-row justify-between items-center mb-1">
                <Text className="text-text-primary text-sm">{item.name}</Text>
                <Text className="text-text-primary font-semibold text-sm">
                  ₱{item.price.toFixed(2)}
                </Text>
              </View>
            ))}
          </View>
        )}

        <InputField
          label="Materials (₱) — optional"
          value={materialsCost}
          onChangeText={setMaterialsCost}
          placeholder="Exactly what the receipt says"
          keyboardType="numeric"
        />

        {needsProof && (
          <>
            <ProofPhotosField
              bookingId={booking.id}
              label="Receipt photos"
              hint="The receipt(s) for these materials"
              urls={receiptUrls}
              onChange={setReceiptUrls}
              required
            />
            <ProofPhotosField
              bookingId={booking.id}
              label="Materials in use"
              hint="The materials installed or used on this job"
              urls={proofOfUseUrls}
              onChange={setProofOfUseUrls}
              required
            />
          </>
        )}

        <InputField
          label="Notes for client — optional"
          value={notes}
          onChangeText={setNotes}
          placeholder="Describe the additional work or materials needed."
          multiline
        />

        {/* Live Total */}
        <View className="bg-success/10 border border-success/30 rounded-2xl p-4 mb-6">
          <Text className="text-text-secondary text-xs">Total Quote</Text>
          <Text className="text-success font-bold text-3xl mt-1">
            ₱{total.toFixed(2)}
          </Text>
          <View className="mt-2">
            <View className="flex-row justify-between">
              <Text className="text-text-muted text-xs">{isCustomQuote ? "Your price" : "Service (settled)"}</Text>
              <Text className="text-text-secondary text-xs">
                ₱{labor.toFixed(2)}
              </Text>
            </View>
            {addOnsTotal > 0 && (
              <View className="flex-row justify-between mt-1">
                <Text className="text-text-muted text-xs">Items added on-site</Text>
                <Text className="text-text-secondary text-xs">
                  ₱{addOnsTotal.toFixed(2)}
                </Text>
              </View>
            )}
            {materials > 0 && (
              <View className="flex-row justify-between mt-1">
                <Text className="text-text-muted text-xs">Materials</Text>
                <Text className="text-text-secondary text-xs">
                  ₱{materials.toFixed(2)}
                </Text>
              </View>
            )}
          </View>
          <View className="border-t border-success/20 mt-2 pt-2">
            <View className="flex-row justify-between">
              <Text className="text-text-muted text-xs">
                Your earnings (after 10% fee)
              </Text>
              <Text className="text-success text-xs font-semibold">
                ₱{(total * 0.9).toFixed(2)}
              </Text>
            </View>
          </View>
        </View>

        {proofMissing && (
          <Text className="text-error text-xs mb-3">Add a receipt photo and a photo of the materials in use.</Text>
        )}
        <View className="gap-3">
          <PrimaryButton
            label={booking.quote?.status === "REJECTED" ? "Submit Revised Quote" : "Submit Quote to Client"}
            fullWidth
            disabled={loading || !canSubmit}
            loading={loading}
            onPress={handleSubmit}
          />
          <OutlinedButton label="Cancel" onPress={() => router.back()} />
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}
