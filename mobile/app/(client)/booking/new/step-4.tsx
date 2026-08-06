import React, { useState } from "react";
import { View, Text, ScrollView, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors } from "../../../../constants";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import StepperHorizontal from "../../../../components/steppers/StepperHorizontal";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import PrioritySelector from "../../../../components/booking4step/PrioritySelector";
import AddOnsToggleGroup from "../../../../components/booking4step/AddOnsToggleGroup";
import PackageSelector from "../../../../components/booking4step/PackageSelector";
import TipSlider from "../../../../components/booking4step/TipSlider";
import PaymentMethodSelector from "../../../../components/booking4step/PaymentMethodSelector";
import PricingRangePreview from "../../../../components/booking4step/PricingRangePreview";
import GenericConfirmationModal from "../../../../components/modals/GenericConfirmationModal";
import { useBookingStore, type Booking } from "../../../../store/bookingStore";
import { useBookingPriceEstimate } from "../../../../hooks/useBookingPriceEstimate";
import { validateDraftForSubmit } from "../../../../utils/bookingValidation";
import { PAYMENT_METHOD_TYPE_MAP } from "../../../../utils/paymentMethodMap";
import {
  ROOM_TYPE_LABELS,
  ADD_ON_TOGGLE_LABELS,
  TIME_SLOT_LABELS,
  CONDITION_LABELS,
  type AddOnToggleKey,
} from "../../../../types/booking4step.types";
import { formatRoomSummary } from "../../../../utils/bookingPriceEstimate";
import * as api from "../../../../services/api";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

const BOOKING_STEPS = ["Scope", "Schedule", "Who", "Confirm"];

const ACCOUNT_FIELD_CONFIG: Record<
  string,
  { title: string; description: string; placeholder: string; keyboardType?: "phone-pad" }
> = {
  gcash: {
    title: "GCash Details",
    description: "Enter the mobile number linked to your GCash account.",
    placeholder: "09XXXXXXXXX",
    keyboardType: "phone-pad",
  },
  maya: {
    title: "Maya Details",
    description: "Enter the mobile number linked to your Maya account.",
    placeholder: "09XXXXXXXXX",
    keyboardType: "phone-pad",
  },
  bank: {
    title: "Bank Transfer Details",
    description: "Enter the reference or account number you'll use for the transfer.",
    placeholder: "Reference / Account Number",
  },
};

export default function BookingStep4Screen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const draft = useBookingStore((s) => s.draft);
  const setDraft = useBookingStore((s) => s.setDraft);
  const setBookingCreated = useBookingStore((s) => s.setBookingCreated);

  const [priorities, setPriorities] = useState<string[]>(draft.priorities ?? []);
  const [addOnToggles, setAddOnToggles] = useState<string[]>(draft.addOnToggles ?? []);
  const [selectedPackageIds, setSelectedPackageIds] = useState<string[]>(draft.selectedPackageIds ?? []);
  const [packagesTotal, setPackagesTotal] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<string | null>(draft.paymentMethod);
  const [accountValue, setAccountValue] = useState("");
  const [tip, setTip] = useState<number>(draft.tip ?? 0);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  const effectiveDraft = { ...draft, paymentMethod, priorities, addOnToggles, tip };
  const validation = validateDraftForSubmit(effectiveDraft);
  const priceEstimate = useBookingPriceEstimate(draft.categoryBasePrice ?? 0, packagesTotal, tip);
  const roomSummary = formatRoomSummary(draft.rooms ?? [], ROOM_TYPE_LABELS);
  const scopeAnswersSummary = Object.entries(draft.scopeAnswers ?? {})
    .map(([label, value]) => `${label}: ${Array.isArray(value) ? value.join(", ") : value}`)
    .join(" · ");

  const requiresAccountValue =
    paymentMethod === "gcash" || paymentMethod === "maya" || paymentMethod === "bank";

  const handleSubmit = () => {
    if (!paymentMethod) {
      alertModal.warning("Payment method required", "Please select a payment method.");
      return;
    }
    if (requiresAccountValue && !accountValue.trim()) {
      alertModal.warning("Payment details", "Please enter the required payment details for this method.");
      return;
    }
    if (!validation.ok) {
      alertModal.error("Booking incomplete", validation.errors.join("\n"));
      return;
    }
    setConfirmVisible(true);
  };

  const onConfirm = async () => {
    setConfirmVisible(false);
    setLoading(true);

    try {
      setDraft({ paymentMethod, priorities, addOnToggles, selectedPackageIds, tip });

      const addOns = addOnToggles.map((key) => ({
        id: key,
        name: ADD_ON_TOGGLE_LABELS[key as AddOnToggleKey],
        price: 0,
      }));

      const response = await api.createBooking({
        workerId: draft.isAutoMatched ? null : draft.workerId,
        serviceType: draft.serviceType || draft.category || "",
        rooms: (draft.rooms ?? []).flatMap((r) => Array(r.count).fill(r.room)),
        condition: draft.condition ?? undefined,
        description: draft.description || undefined,
        address: draft.address || "",
        city: draft.city,
        lat: draft.lat!,
        lng: draft.lng!,
        date: draft.date!,
        timeSlot: draft.timeSlot!,
        addOns,
        packageIds: selectedPackageIds,
        priorities,
        tip,
        notes: draft.notes || draft.instructions,
        paymentMethodType: PAYMENT_METHOD_TYPE_MAP[paymentMethod!],
        paymentAccountIdentifier: accountValue.trim() || undefined,
        scopeAnswers: draft.scopeAnswers,
        issuePhotoUrls: draft.issuePhotoUrls,
      });

      const createdBooking: Booking = {
        id: response.id,
        service: draft.category || draft.serviceType || "Service",
        worker: response.workerName ?? "To be assigned",
        workerId: response.workerName ? (draft.workerId ?? undefined) : undefined,
        date: response.scheduledDate,
        time: response.timeSlot ? TIME_SLOT_LABELS[response.timeSlot] : undefined,
        address: draft.address || undefined,
        status: "Pending",
        amount: response.pricing?.finalEstimate ?? response.estimatedPrice ?? draft.estimatedPrice ?? 0,
        category: draft.category ?? undefined,
      };

      setBookingCreated(createdBooking);
      router.push("/(client)/booking/success");
    } catch (err) {
      console.error("Booking creation error:", err);
      alertModal.error(
        "Booking failed",
        err instanceof Error ? err.message : "Failed to create booking. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Confirm & Book" showBack />
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
        <StepperHorizontal steps={BOOKING_STEPS} currentStep={3} />

        {!validation.ok && (
          <View className="bg-yellow-100 rounded-xl p-3 mb-4">
            <Text className="text-yellow-900 font-semibold">Booking incomplete</Text>
            {validation.errors.map((e) => (
              <Text key={e} className="text-yellow-900 text-sm">
                - {e}
              </Text>
            ))}
          </View>
        )}

        {/* Booking summary */}
        <View className="bg-card rounded-2xl p-4">
          <Text className="text-text-primary font-bold mb-3">Summary</Text>
          <SummaryRow label="Pro" value={draft.isAutoMatched ? "Surprise Me (auto-assigned)" : draft.workerName || "—"} />
          <SummaryRow label="Service" value={draft.category || "—"} />
          {draft.scopeType === "CUSTOM" ? (
            <SummaryRow label="Details" value={scopeAnswersSummary || "—"} />
          ) : (
            <SummaryRow label="Rooms" value={roomSummary || "—"} />
          )}
          {draft.hasCondition !== false && (
            <SummaryRow label="Condition" value={draft.condition ? CONDITION_LABELS[draft.condition] : "—"} />
          )}
          <SummaryRow
            label="Date & Time"
            value={`${draft.date ?? "—"} · ${draft.timeSlot ? TIME_SLOT_LABELS[draft.timeSlot] : "—"}`}
          />
          <SummaryRow label="Address" value={draft.address || "—"} last />
        </View>

        <View className="mt-4">
          <PricingRangePreview estimate={priceEstimate} />
        </View>

        <View className="mt-6">
          <PrioritySelector selected={priorities} onChange={setPriorities} />
        </View>

        <Text className="text-text-primary font-bold text-sm mb-2 mt-6">Packages</Text>
        <PackageSelector
          workerId={draft.isAutoMatched ? null : draft.workerId}
          serviceTypeId={draft.serviceTypeId}
          selected={selectedPackageIds}
          onChange={setSelectedPackageIds}
          onSelectedTotalChange={setPackagesTotal}
        />

        <Text className="text-text-primary font-bold text-sm mb-2 mt-6">Job Preferences</Text>
        <AddOnsToggleGroup selected={addOnToggles} onChange={setAddOnToggles} />

        <Text className="text-text-primary font-bold text-sm mb-2 mt-6">Payment Method</Text>
        <PaymentMethodSelector value={paymentMethod} onChange={setPaymentMethod} />

        {paymentMethod && ACCOUNT_FIELD_CONFIG[paymentMethod] && (
          <View className="bg-card rounded-2xl p-4 mt-3">
            <Text className="text-text-primary font-semibold mb-2">
              {ACCOUNT_FIELD_CONFIG[paymentMethod].title}
            </Text>
            <Text className="text-text-secondary text-xs mb-2">
              {ACCOUNT_FIELD_CONFIG[paymentMethod].description}
            </Text>
            <TextInput
              className="bg-white rounded-xl px-3 py-2 text-text-primary border border-gray-200"
              placeholder={ACCOUNT_FIELD_CONFIG[paymentMethod].placeholder}
              placeholderTextColor={colors.text.secondary}
              keyboardType={ACCOUNT_FIELD_CONFIG[paymentMethod].keyboardType}
              value={accountValue}
              onChangeText={setAccountValue}
            />
          </View>
        )}

        <Text className="text-text-primary font-bold text-sm mb-2 mt-6">Add a Tip</Text>
        <TipSlider value={tip} onChange={setTip} />

        <View className="mt-8">
          <PrimaryButton
            label="Submit booking request"
            fullWidth
            disabled={
              !paymentMethod ||
              loading ||
              !validation.ok ||
              (requiresAccountValue && !accountValue.trim())
            }
            loading={loading}
            onPress={handleSubmit}
          />
        </View>
      </ScrollView>

      <GenericConfirmationModal
        visible={confirmVisible}
        title="Submit booking request"
        message="You are about to submit a booking request. Your payment method will be authorized and held until the job is completed."
        confirmLabel="Submit Request"
        cancelLabel="Cancel"
        onConfirm={onConfirm}
        onCancel={() => setConfirmVisible(false)}
      />
    </SafeAreaView>
  );
}

function SummaryRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View className={`flex-row justify-between ${last ? "" : "mb-2"}`}>
      <Text className="text-text-secondary text-sm">{label}</Text>
      <Text className="text-text-primary text-sm font-medium flex-1 text-right ml-3" numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}
