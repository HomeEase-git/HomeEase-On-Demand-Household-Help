import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, TextInput, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import { colors } from "../../../../constants";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import StepperHorizontal from "../../../../components/steppers/StepperHorizontal";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import AddOnsToggleGroup from "../../../../components/booking4step/AddOnsToggleGroup";
import PackageSelector from "../../../../components/booking4step/PackageSelector";
import TipSlider from "../../../../components/booking4step/TipSlider";
import PaymentMethodSelector from "../../../../components/booking4step/PaymentMethodSelector";
import PricingRangePreview from "../../../../components/booking4step/PricingRangePreview";
import GenericConfirmationModal from "../../../../components/modals/GenericConfirmationModal";
import { useBookingStore, type Booking } from "../../../../store/bookingStore";
import { useBookingPriceEstimate } from "../../../../hooks/useBookingPriceEstimate";
import { useWorkerDiscovery } from "../../../../hooks/useWorkerDiscovery";
import { validateDraftForSubmit } from "../../../../utils/bookingValidation";
import { PAYMENT_METHOD_TYPE_MAP } from "../../../../utils/paymentMethodMap";
import {
  ADD_ON_TOGGLE_LABELS,
  TIME_SLOT_LABELS,
  PET_FRIENDLY_PRIORITY,
  type AddOnToggleKey,
  type CreateMultiDayBookingResponse,
} from "../../../../types/booking4step.types";
import { generateIdempotencyKey } from "../../../../utils/idempotencyKey";
import * as api from "../../../../services/api";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

const BOOKING_STEPS = ["Scope", "Schedule", "Who", "Confirm"];

const ACCOUNT_FIELD_CONFIG: Record<
  string,
  { title: string; placeholder: string; keyboardType?: "phone-pad" }
> = {
  gcash: {
    title: "GCash Number",
    placeholder: "09XXXXXXXXX",
    keyboardType: "phone-pad",
  },
  maya: {
    title: "Maya Number",
    placeholder: "09XXXXXXXXX",
    keyboardType: "phone-pad",
  },
};

export default function BookingStep4Screen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const draft = useBookingStore((s) => s.draft);
  const setDraft = useBookingStore((s) => s.setDraft);
  const setBookingCreated = useBookingStore((s) => s.setBookingCreated);

  const [hasPets, setHasPets] = useState<boolean>(
    (draft.priorities ?? []).includes(PET_FRIENDLY_PRIORITY)
  );
  const [addOnToggles, setAddOnToggles] = useState<string[]>(draft.addOnToggles ?? []);
  const [selectedPackageIds, setSelectedPackageIds] = useState<string[]>(draft.selectedPackageIds ?? []);
  const [packagesTotal, setPackagesTotal] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<string | null>(draft.paymentMethod);
  const [accountValue, setAccountValue] = useState(draft.paymentAccountIdentifier ?? "");
  const [tip, setTip] = useState<number>(draft.tip ?? 0);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  // Multi-day upfront booking (see step-2.tsx's day-count stepper, only
  // offered once a specific worker is locked in) — >1 means this submits
  // via POST /bookings/multi-day instead of the ordinary POST /bookings.
  const dayCount = draft.dayCount ?? 1;
  const isMultiDay = dayCount > 1;

  // Unlike Steps 1-3 (which each commit their fields to the draft store the
  // moment the user taps "Next"), Step 4 is the last screen before submit —
  // there's no forward transition to hang a commit off of. Without writing
  // these through immediately, navigating back to Step 3/2 (e.g. to change
  // pro or slot) and returning here remounts this screen and silently resets
  // payment method/account number/tip/pets/packages back to the draft's last
  // saved values.
  const updateHasPets = (value: boolean) => {
    setHasPets(value);
    setDraft({ priorities: value ? [PET_FRIENDLY_PRIORITY] : [] });
  };
  const updateAddOnToggles = (value: string[]) => {
    setAddOnToggles(value);
    setDraft({ addOnToggles: value });
  };
  const updateSelectedPackageIds = (value: string[]) => {
    setSelectedPackageIds(value);
    setDraft({ selectedPackageIds: value });
  };
  const updatePaymentMethod = (value: string) => {
    setPaymentMethod(value);
    setDraft({ paymentMethod: value });
  };
  const updateAccountValue = (value: string) => {
    setAccountValue(value);
    setDraft({ paymentAccountIdentifier: value || null });
  };
  const updateTip = (value: number) => {
    setTip(value);
    setDraft({ tip: value });
  };

  const priorities = hasPets ? [PET_FRIENDLY_PRIORITY] : [];
  const effectiveDraft = { ...draft, paymentMethod, priorities, addOnToggles, tip };
  const validation = validateDraftForSubmit(effectiveDraft);
  // A selected task's own admin range (same source Step 1 used) takes
  // priority over the category-wide spread once one's been picked — only
  // matters pre-worker-known (auto-match); a picked worker's real rate
  // always wins inside the hook regardless of what's passed here.
  const priceEstimate = useBookingPriceEstimate(
    {
      min: draft.selectedTaskPriceRangeMin ?? draft.categoryPriceRangeMin ?? draft.categoryBasePrice ?? 0,
      max: draft.selectedTaskPriceRangeMax ?? draft.categoryPriceRangeMax ?? draft.categoryBasePrice ?? 0,
    },
    packagesTotal,
    tip
  );
  const scopeAnswersSummary = Object.entries(draft.scopeAnswers ?? {})
    .map(([label, value]) => `${label}: ${Array.isArray(value) ? value.join(", ") : value}`)
    .join(" · ");

  // Re-verify the held worker/slot is still actually open right before the
  // user commits — the HoldTimerBadge in Step 3 is a UX countdown only, not
  // a real server-side reservation, so the first sign it died could
  // otherwise be a 409 at submit, after filling in packages/payment/tip.
  // Scoped to this specific worker (workerId filter) when one was picked or
  // locked in; unscoped (any pro) for an auto-matched booking.
  const readyToCheckAvailability = !!draft.serviceType && !!draft.date && !!draft.timeSlot;
  const {
    workers: availabilityCheck,
    loading: checkingAvailability,
    error: availabilityError,
    refetch: recheckAvailability,
  } = useWorkerDiscovery(
    {
      serviceType: draft.serviceType ?? undefined,
      serviceTaskId: draft.serviceTaskId ?? undefined,
      date: draft.date ?? undefined,
      timeSlot: draft.timeSlot ?? undefined,
      scopeAnswers: draft.scopeAnswers,
      workerId: draft.isAutoMatched ? undefined : (draft.workerId ?? undefined),
      limit: 1,
    },
    readyToCheckAvailability
  );
  const slotNoLongerAvailable =
    readyToCheckAvailability && !checkingAvailability && !availabilityError && availabilityCheck.length === 0;

  // Runs on every focus (not just mount) — catches a slot dying while the
  // user was away from this screen (backgrounded, or navigated back and
  // forth), not just at first load.
  useFocusEffect(
    useCallback(() => {
      recheckAvailability();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draft.serviceType, draft.date, draft.timeSlot, draft.workerId, draft.isAutoMatched])
  );

  const requiresAccountValue = paymentMethod === "gcash" || paymentMethod === "maya";
  // PH mobile number, local (09XXXXXXXXX) or international (+639XXXXXXXXX)
  // format — matches the "09XXXXXXXXX" placeholder shown for both methods.
  const PH_MOBILE_NUMBER_PATTERN = /^(09\d{9}|\+639\d{9})$/;

  const handleSubmit = () => {
    if (slotNoLongerAvailable) {
      alertModal.warning(
        "Slot no longer available",
        draft.isAutoMatched
          ? "No pro is available for this date/time anymore. Please pick a different time."
          : `${draft.workerName ?? "This pro"} is no longer available for this date/time. Please pick a different time or pro.`
      );
      return;
    }
    if (!paymentMethod) {
      alertModal.warning("Payment method required", "Please select a payment method.");
      return;
    }
    if (requiresAccountValue) {
      const trimmed = accountValue.trim();
      if (!trimmed) {
        alertModal.warning("Payment details", "Please enter the required payment details for this method.");
        return;
      }
      if (!PH_MOBILE_NUMBER_PATTERN.test(trimmed)) {
        alertModal.warning("Payment details", "Enter a valid mobile number, e.g. 09XXXXXXXXX.");
        return;
      }
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
      // Reuse the key already on the draft (a retry after a failed/hung
      // attempt) rather than generating a fresh one each time — that's what
      // lets the backend recognize a retried submit as the same request.
      // Persisted immediately (setDraft writes through to storage) so it
      // survives the app being backgrounded/killed mid-request too.
      const idempotencyKey = draft.idempotencyKey ?? generateIdempotencyKey();
      setDraft({
        paymentMethod,
        paymentAccountIdentifier: accountValue.trim() || null,
        priorities,
        addOnToggles,
        selectedPackageIds,
        tip,
        idempotencyKey,
      });

      let createdBooking: Booking;

      if (isMultiDay) {
        // No addOns/packageIds/tip — not supported by /bookings/multi-day
        // yet (see backend createMultiDayBooking's docblock for why).
        const response: CreateMultiDayBookingResponse = await api.createMultiDayBooking({
          workerId: draft.workerId!,
          serviceType: draft.serviceType || draft.category || "",
          serviceTaskId: draft.serviceTaskId ?? undefined,
          description: draft.description || undefined,
          address: draft.address || "",
          city: draft.city,
          lat: draft.lat!,
          lng: draft.lng!,
          startDate: draft.date!,
          dayCount,
          timeSlot: draft.timeSlot!,
          priorities,
          paymentMethodType: PAYMENT_METHOD_TYPE_MAP[paymentMethod!],
          paymentAccountIdentifier: accountValue.trim() || undefined,
          scopeAnswers: draft.scopeAnswers,
          issuePhotoUrls: draft.issuePhotoUrls,
          idempotencyKey,
        });

        const firstDay = response.bookings[0];
        createdBooking = {
          id: firstDay.id,
          service: draft.category || draft.serviceType || "Service",
          worker: draft.workerName || "Assigned pro",
          workerId: draft.workerId ?? undefined,
          date: firstDay.scheduledDate,
          time: firstDay.timeSlot ? TIME_SLOT_LABELS[firstDay.timeSlot] : undefined,
          address: draft.address || undefined,
          status: "Pending",
          amount: response.totalEstimatedPrice,
          category: draft.category ?? undefined,
          groupId: response.groupId,
          groupTotalDays: response.totalDays,
          groupDayIndex: 1,
        };
      } else {
        const addOns = addOnToggles.map((key) => ({
          id: key,
          name: ADD_ON_TOGGLE_LABELS[key as AddOnToggleKey],
          price: 0,
        }));

        const response = await api.createBooking({
          workerId: draft.isAutoMatched ? null : draft.workerId,
          serviceType: draft.serviceType || draft.category || "",
          serviceTaskId: draft.serviceTaskId ?? undefined,
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
          paymentMethodType: PAYMENT_METHOD_TYPE_MAP[paymentMethod!],
          paymentAccountIdentifier: accountValue.trim() || undefined,
          scopeAnswers: draft.scopeAnswers,
          issuePhotoUrls: draft.issuePhotoUrls,
          idempotencyKey,
        });

        createdBooking = {
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
          priceBreakdown: response.pricing
            ? {
                basePrice: response.pricing.basePrice,
                distanceFee: response.pricing.distanceFee,
                tierFee: response.pricing.tierFee,
                addOns: response.pricing.addOns,
                subtotal: response.pricing.finalEstimate,
                // VAT isn't known until settlement (see backend
                // Booking.vatAmount schema comment) — nothing to show yet.
                vatApplicable: false,
                vatRate: null,
                vatAmount: 0,
                tip,
                total: Math.round((response.pricing.finalEstimate + tip) * 100) / 100,
              }
            : null,
        };
      }

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

        {slotNoLongerAvailable && (
          <View className="bg-error/10 border border-error rounded-2xl p-3.5 mb-4 flex-row items-start">
            <Ionicons name="alert-circle" size={18} color={colors.error} style={{ marginTop: 1 }} />
            <View className="flex-1 ml-2.5">
              <Text className="text-error font-bold text-sm">This slot is no longer available</Text>
              <Text className="text-error text-xs mt-0.5">
                {draft.isAutoMatched
                  ? "No pro is available for this date/time anymore."
                  : `${draft.workerName ?? "This pro"} is no longer available for this date/time.`}
              </Text>
              <View className="mt-2.5">
                <OutlinedButton
                  label="Change date/time"
                  onPress={() => router.push("/(client)/booking/new/step-2")}
                />
              </View>
            </View>
          </View>
        )}

        {/* Booking summary */}
        <View className="bg-card rounded-2xl p-4">
          <Text className="text-text-primary font-bold mb-3">Summary</Text>
          <SummaryRow label="Pro" value={draft.isAutoMatched ? "Auto-matched" : draft.workerName || "—"} />
          <SummaryRow label="Service" value={draft.category || "—"} />
          <SummaryRow label="Details" value={scopeAnswersSummary || "—"} />
          <SummaryRow
            label={isMultiDay ? "Starts" : "Date & Time"}
            value={`${draft.date ?? "—"} · ${draft.timeSlot ? TIME_SLOT_LABELS[draft.timeSlot] : "—"}${
              isMultiDay ? ` · ${dayCount} days` : ""
            }`}
          />
          <SummaryRow label="Address" value={draft.address || "—"} last />
        </View>

        <View className="mt-4">
          <PricingRangePreview estimate={priceEstimate} />
        </View>

        {isMultiDay && (
          <View className="bg-card rounded-xl p-3.5 mt-3">
            <Text className="text-text-secondary text-xs">
              The estimate above is per day. {dayCount} days come to about{" "}
              {priceEstimate.mode === "point"
                ? `₱${Math.round(priceEstimate.point.total * dayCount)}`
                : `₱${Math.round(priceEstimate.range.min * dayCount)} – ₱${Math.round(priceEstimate.range.max * dayCount)}`}
              . Packages, job preferences and tips aren&apos;t available for multi-day bookings.
            </Text>
          </View>
        )}

        <Text className="text-text-primary font-bold text-sm mb-2 mt-6">Pets</Text>
        <View className="bg-card rounded-xl p-3.5 flex-row items-center">
          <View className="flex-1 pr-3">
            <Text className="text-text-primary font-semibold text-sm">I have pets at home</Text>
            <Text className="text-text-muted text-xs mt-0.5">
              We&apos;ll match you with a pet-friendly pro
            </Text>
          </View>
          <Switch
            value={hasPets}
            onValueChange={updateHasPets}
            trackColor={{ false: colors.toggleOff, true: colors.accent.DEFAULT }}
            thumbColor={colors.white}
          />
        </View>

        {!isMultiDay && (
          <>
            <Text className="text-text-primary font-bold text-sm mb-2 mt-6">Packages</Text>
            <PackageSelector
              workerId={draft.isAutoMatched ? null : draft.workerId}
              serviceTypeId={draft.serviceTypeId}
              selected={selectedPackageIds}
              onChange={updateSelectedPackageIds}
              onSelectedTotalChange={setPackagesTotal}
            />

            <Text className="text-text-primary font-bold text-sm mb-2 mt-6">Job Preferences</Text>
            <AddOnsToggleGroup selected={addOnToggles} onChange={updateAddOnToggles} />
          </>
        )}

        <Text className="text-text-primary font-bold text-sm mb-2 mt-6">Payment Method</Text>
        <PaymentMethodSelector value={paymentMethod} onChange={updatePaymentMethod} />

        {paymentMethod && ACCOUNT_FIELD_CONFIG[paymentMethod] && (
          <View className="bg-card rounded-2xl p-4 mt-3">
            <Text className="text-text-primary font-semibold mb-2">
              {ACCOUNT_FIELD_CONFIG[paymentMethod].title}
            </Text>
            <TextInput
              className="bg-white rounded-xl px-3 py-2 text-text-primary border border-gray-200"
              style={{ minHeight: 44, includeFontPadding: false, textAlignVertical: "center" }}
              placeholder={ACCOUNT_FIELD_CONFIG[paymentMethod].placeholder}
              placeholderTextColor={colors.text.secondary}
              keyboardType={ACCOUNT_FIELD_CONFIG[paymentMethod].keyboardType}
              value={accountValue}
              onChangeText={updateAccountValue}
            />
          </View>
        )}

        {!isMultiDay && (
          <>
            <Text className="text-text-primary font-bold text-sm mb-2 mt-6">Add a Tip</Text>
            <TipSlider value={tip} onChange={updateTip} />
          </>
        )}

        <View className="mt-8">
          <PrimaryButton
            label={isMultiDay ? `Submit ${dayCount}-day booking request` : "Submit booking request"}
            fullWidth
            disabled={
              !paymentMethod ||
              loading ||
              !validation.ok ||
              slotNoLongerAvailable ||
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
        message="No charge now. You'll pay after the job is done and you've confirmed it."
        confirmLabel="Submit"
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
