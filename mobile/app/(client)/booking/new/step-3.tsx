import React, { useState, useRef, useMemo } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
// eslint-disable-next-line import/no-named-as-default
import ScreenHeader from "../../../../components/ui/ScreenHeader";
// eslint-disable-next-line import/no-named-as-default
import StepperHorizontal from "../../../../components/steppers/StepperHorizontal";
// eslint-disable-next-line import/no-named-as-default
import PrimaryButton from "../../../../components/ui/PrimaryButton";
// eslint-disable-next-line import/no-named-as-default
import InputField from "../../../../components/ui/InputField";
import PriceBreakdownCard from "../../../../components/ui/PriceBreakdown";
import {
  useBookingStore,
  type Booking,
  type BookingState,
} from "../../../../store/bookingStore";
import { calculatePriceBreakdown } from "../../../../utils/pricing";
import { validateDraftForSubmit } from "../../../../utils/bookingValidation";
// eslint-disable-next-line import/no-named-as-default
import PaymentMethodBottomSheet from "../../../../components/bottom-sheets/PaymentMethodBottomSheet";
// eslint-disable-next-line import/no-named-as-default
import GenericConfirmationModal from "../../../../components/modals/GenericConfirmationModal";
import * as api from "../../../../services/api";
import { serviceConfigs } from "../../../../constants/serviceData";
import type { BottomSheetHandle } from "../../../../components/bottom-sheets/BottomSheetWrapper";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

export default function BookingStep3Screen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const draft = useBookingStore((s: BookingState) => s.draft);
  const setDraft = useBookingStore((s: BookingState) => s.setDraft);
  const setBookingCreated = useBookingStore(
    (s: BookingState) => s.setBookingCreated,
  );
  const [paymentMethod, setPaymentMethod] = useState<string | null>(
    draft.paymentMethod,
  );
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tipAmount, setTipAmount] = useState<number>(draft.tip || 0);
  const [customTip, setCustomTip] = useState<string>("");
  const [showCustomTip, setShowCustomTip] = useState(false);
  const paymentRef = useRef<BottomSheetHandle | null>(null);

  const paymentLabel =
    paymentMethod === "gcash"
      ? "GCash"
      : paymentMethod === "maya"
        ? "Maya"
        : paymentMethod === "bank"
          ? "Bank Transfer"
          : paymentMethod === "cash"
            ? "Cash"
            : null;

  // Calculate price breakdown using utility
  const priceBreakdown = useMemo(() => {
    const baseAmount = draft.estimatedPrice > 0 ? draft.estimatedPrice : 400;
    return calculatePriceBreakdown(baseAmount, 1, 0, tipAmount);
  }, [draft.estimatedPrice, tipAmount]);

  const handleConfirmBooking = () => {
    setConfirmVisible(true);
  };

  const validation = validateDraftForSubmit(draft);

  const onConfirm = async () => {
    setConfirmVisible(false);

    if (!draft.workerId) {
      alertModal.error(
        "Error",
        "Missing worker information. Please go back and select a worker.",
      );
      return;
    }
    if (!draft.selectedTaskId) {
      alertModal.error(
        "Error",
        "Missing service information. Please go back and select a service.",
      );
      return;
    }

    setLoading(true);
    try {
      setDraft({ paymentMethod });

      // Create booking with correct API field names
      const bookingData = {
        workerId: draft.workerId,
        serviceTaskId: draft.selectedTaskId,
        location: draft.address || "",
        city: draft.city || "",
        scheduledDate: draft.date || new Date().toISOString().split("T")[0],
        scheduledTime: draft.time || "",
        description: draft.description || draft.category || "",
        notes: draft.notes || draft.instructions || "",
        estimatedPrice: draft.estimatedPrice || 0,
        tip: tipAmount || 0,
        addOns: (() => {
          if (!draft.selectedAddOnIds || !draft.category) return [];
          const cfg = serviceConfigs.find(
            (c) =>
              c.categoryName.toLowerCase() ===
              (draft.category || "").toLowerCase(),
          );
          if (!cfg) return [];
          return draft.selectedAddOnIds.map((id: string) => {
            const ao = cfg.addOns.find((a) => a.id === id);
            return ao
              ? { id: ao.id, name: ao.name, price: ao.price }
              : { id, name: id, price: 0 };
          });
        })(),
      };

      const response = await api.createBooking(bookingData);

      // The API only returns a partial payload (id, clientName, workerName,
      // scheduledDate, ...) - normalize it into the shape the store/UI expect
      // (date, worker, service, amount) before saving, otherwise the booking
      // detail screen renders with missing fields and crashes on an invalid date.
      const createdBooking: Booking = {
        id: response.id,
        service: draft.category || "Service",
        worker: response.workerName ?? "Unassigned",
        workerId: draft.workerId ?? undefined,
        date: response.scheduledDate ?? bookingData.scheduledDate,
        time: response.scheduledTime || undefined,
        address: draft.address || undefined,
        status: "Pending",
        amount: response.estimatedPrice ?? draft.estimatedPrice ?? 0,
        category: draft.category ?? undefined,
        selectedTaskId: draft.selectedTaskId ?? undefined,
        selectedAddOnIds: draft.selectedAddOnIds,
      };

      // Update booking store
      setBookingCreated(createdBooking);

      router.push("/(client)/booking/success");
    } catch (err) {
      console.error("Booking creation error:", err);
      alertModal.error("Error", "Failed to create booking. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Review & Payment" showBack />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 24, paddingBottom: 40 }}
      >
        <StepperHorizontal
          steps={["Service", "Schedule", "Payment"]}
          currentStep={2}
        />
        {!validation.ok && (
          <View className="bg-yellow-100 rounded-xl p-3 mb-4">
            <Text className="text-yellow-900 font-semibold">
              Booking incomplete
            </Text>
            {validation.errors.map((e) => (
              <Text key={e} className="text-yellow-900 text-sm">
                - {e}
              </Text>
            ))}
            <View className="mt-2 flex-row gap-2">
              <Pressable
                onPress={() => router.push("/(client)/booking/new/step-1")}
              >
                <Text className="text-accent">Go to Step 1</Text>
              </Pressable>
              <Pressable
                onPress={() => router.push("/(client)/booking/new/step-2")}
              >
                <Text className="text-accent">Go to Step 2</Text>
              </Pressable>
            </View>
          </View>
        )}

        <View className="bg-card rounded-2xl p-4 mt-4">
          <Text className="text-text-primary font-bold mb-2">Summary</Text>
          <Text className="text-text-secondary text-sm">
            Service: {draft.category}
          </Text>
          <Text className="text-text-secondary text-sm">
            Address: {draft.address}
          </Text>
          <Text className="text-text-secondary text-sm">
            Date: {draft.date} · Time: {draft.time}
          </Text>
        </View>

        {draft.quoteRequired && (
          <View className="bg-warning/10 rounded-2xl p-3 mt-3">
            <Text className="text-warning text-xs">
              This is an inspection-based service. The price below is an estimate — the worker will send you a final quote to approve before starting work.
            </Text>
          </View>
        )}

        <Text className="text-text-secondary font-bold text-sm mb-1 mt-4">
          Payment Method
        </Text>
        <Pressable
          className="bg-card rounded-xl p-4 flex-row justify-between"
          onPress={() => paymentRef.current?.expand()}
        >
          <Text
            className={
              paymentLabel ? "text-brand font-semibold" : "text-text-muted"
            }
          >
            {paymentLabel ?? "Select payment method"}
          </Text>
        </Pressable>

        <Text className="text-text-secondary font-bold text-sm mb-1 mt-4">
          Add a Tip
        </Text>
        <View className="flex-row gap-2 flex-wrap mt-1">
          {[0, 20, 50, 100].map((amount) => (
            <Pressable
              key={amount}
              className={
                tipAmount === amount
                  ? "bg-accent rounded-xl px-4 py-2"
                  : "bg-card rounded-xl px-4 py-2"
              }
              onPress={() => {
                setTipAmount(amount);
                setShowCustomTip(false);
                setCustomTip("");
                setDraft({ tip: amount });
              }}
            >
              <Text
                className={
                  tipAmount === amount
                    ? "text-white font-semibold text-sm"
                    : "text-text-secondary text-sm"
                }
              >
                {amount === 0 ? "No Tip" : `₱${amount}`}
              </Text>
            </Pressable>
          ))}
          <Pressable
            className={
              showCustomTip
                ? "bg-accent rounded-xl px-4 py-2"
                : "bg-card rounded-xl px-4 py-2"
            }
            onPress={() => setShowCustomTip(true)}
          >
            <Text
              className={
                showCustomTip
                  ? "text-white font-semibold text-sm"
                  : "text-text-secondary text-sm"
              }
            >
              Custom
            </Text>
          </Pressable>
        </View>

        {showCustomTip && (
          <View className="mt-3">
            <InputField
              label=""
              value={customTip}
              onChangeText={(value) => {
                setCustomTip(value);
                const parsedValue = parseFloat(value) || 0;
                setTipAmount(parsedValue);
                setDraft({ tip: parsedValue });
              }}
              placeholder="Enter custom amount"
              keyboardType="numeric"
            />
          </View>
        )}

        <View className="mt-6">
          <PriceBreakdownCard breakdown={priceBreakdown} detailed={true} />
        </View>

        <View className="mt-8">
          <PrimaryButton
            label={
              draft.quoteRequired
                ? "Submit request for quote"
                : "Submit booking request"
            }
            fullWidth
            disabled={!paymentMethod || loading || !validation.ok}
            loading={loading}
            onPress={() => {
              if (!paymentMethod) {
                alertModal.warning("Error", "Please select a payment method");
                return;
              }
              handleConfirmBooking();
            }}
          />
        </View>
      </ScrollView>
      <PaymentMethodBottomSheet
        innerRef={paymentRef}
        onSelect={(m) => {
          setPaymentMethod(m);
          setDraft({ paymentMethod: m });
        }}
      />
      <GenericConfirmationModal
        visible={confirmVisible}
        title="Submit booking request"
        message={
          draft.quoteRequired
            ? "The worker will inspect the job and send you a quote to approve before starting work. Payment will not be charged at this time."
            : "You are about to submit a booking request. Payment will not be charged at this time."
        }
        confirmLabel="Submit Request"
        cancelLabel="Cancel"
        onConfirm={onConfirm}
        onCancel={() => setConfirmVisible(false)}
      />
    </SafeAreaView>
  );
}
