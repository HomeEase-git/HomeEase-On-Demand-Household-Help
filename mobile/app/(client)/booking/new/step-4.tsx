import React, { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, Pressable } from "react-native";
import { KeyboardAwareScrollView } from "../../../../components/ui/KeyboardAwareScrollView";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import { colors } from "../../../../constants";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import StepperHorizontal from "../../../../components/steppers/StepperHorizontal";
import { BookingFooterBar } from "../../../../components/booking4step/BookingFooterBar";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import TipSlider from "../../../../components/booking4step/TipSlider";
import PaymentMethodSelector from "../../../../components/booking4step/PaymentMethodSelector";
import PricingRangePreview from "../../../../components/booking4step/PricingRangePreview";
import { useBookingStore, type Booking } from "../../../../store/bookingStore";
import { useBookingPriceEstimate } from "../../../../hooks/useBookingPriceEstimate";
import { useWorkerDiscovery } from "../../../../hooks/useWorkerDiscovery";
import { validateDraftForSubmit } from "../../../../utils/bookingValidation";
import { PAYMENT_METHOD_TYPE_MAP } from "../../../../utils/paymentMethodMap";
import { PET_FRIENDLY_PRIORITY } from "../../../../types/booking4step.types";
import { formatTime12h, isRushDate } from "../../../../utils/bookingTime";
import { generateIdempotencyKey } from "../../../../utils/idempotencyKey";
import { isPhMobileNumber } from "../../../../utils/paymentAccount";
import { feedback } from "../../../../utils/feedback";
import * as api from "../../../../services/api";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

const BOOKING_STEPS = ["Service", "When & where", "Book"];

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

  // Pets and packages are picked earlier (Step 1 / the worker picker); this
  // screen only adds payment and an optional tip.
  const priorities = draft.priorities ?? [];
  const hasPets = priorities.includes(PET_FRIENDLY_PRIORITY);
  const selectedPackageIds = draft.selectedPackageIds ?? [];
  const packagesTotal = draft.selectedPackagesTotal ?? 0;
  // Cash unless the client has a saved default (picked up below) — one less
  // choice before booking.
  const [paymentMethod, setPaymentMethod] = useState<string | null>(draft.paymentMethod ?? "cash");
  const [accountValue, setAccountValue] = useState(draft.paymentAccountIdentifier ?? "");
  const [tip, setTip] = useState<number>(draft.tip ?? 0);
  const [loading, setLoading] = useState(false);

  const isRush = isRushDate(draft.date);
  const isFollowUp = !!draft.parentBookingId;

  // Unlike Steps 1-3 (which each commit their fields to the draft store the
  // moment the user taps "Next"), Step 4 is the last screen before submit —
  // there's no forward transition to hang a commit off of. Without writing
  // these through immediately, navigating back to Step 3/2 (e.g. to change
  // worker or slot) and returning here remounts this screen and silently resets
  // payment method/account number/tip back to the draft's last saved values.
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

  const effectiveDraft = { ...draft, paymentMethod, priorities, addOnToggles: [], tip };
  const scopeAnswersSummary = Object.entries(draft.scopeAnswers ?? {})
    .map(([label, value]) => `${label}: ${Array.isArray(value) ? value.join(", ") : value}`)
    .join("\n");
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

  // Re-verify the held worker is still available that day right before the
  // user commits — the HoldTimerBadge in Step 3 is a UX countdown only, not
  // a real server-side reservation, so the first sign it died could
  // otherwise be a 409 at submit, after filling in packages/payment/tip.
  // Scoped to this specific worker (workerId filter) when one was picked or
  // locked in; unscoped (any worker) for an auto-matched booking.
  // A follow-up job goes to the same worker regardless of their schedule (they
  // accept or decline it), so there's nothing to re-check.
  const readyToCheckAvailability = !!draft.serviceType && !!draft.date && !!draft.time && !isFollowUp;
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
    }, [draft.serviceType, draft.date, draft.workerId, draft.isAutoMatched])
  );

  // Preselect the default saved payment method (and its number) when none is chosen yet.
  useEffect(() => {
    if (draft.paymentMethod) return;
    let active = true;
    api
      .getPaymentMethods()
      .then((methods: any[]) => {
        const preferred = methods.find((m) => m.isDefault);
        if (!active || !preferred) return;
        const id = String(preferred.type).toLowerCase();
        if (!PAYMENT_METHOD_TYPE_MAP[id]) return;
        updatePaymentMethod(id);
        // Only a usable number; a masked value would just fail validation.
        if (id !== "cash" && isPhMobileNumber(String(preferred.accountIdentifier ?? ""))) {
          updateAccountValue(String(preferred.accountIdentifier).trim());
        }
      })
      .catch(() => {}); // a convenience only; the picker still works
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requiresAccountValue = paymentMethod === "gcash" || paymentMethod === "maya";

  const handleSubmit = () => {
    if (slotNoLongerAvailable) {
      alertModal.warning(
        "No longer available",
        draft.isAutoMatched
          ? "No worker is available on this date anymore. Please pick a different date."
          : `${draft.workerName ?? "This worker"} is no longer available on this date. Please pick a different date or worker.`
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
      if (!isPhMobileNumber(trimmed)) {
        alertModal.warning("Payment details", "Enter a valid mobile number, e.g. 09XXXXXXXXX.");
        return;
      }
    }
    if (!validation.ok) {
      alertModal.error("Booking incomplete", validation.errors.join("\n"));
      return;
    }
    // No second "are you sure" step: nothing is charged now, and the client
    // can cancel for free until a worker confirms.
    submit();
  };

  const submit = async () => {
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
        addOnToggles: [],
        selectedPackageIds,
        tip,
        idempotencyKey,
      });

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
        time: draft.time!,
        parentBookingId: draft.parentBookingId ?? undefined,
        addOns: [],
        packageIds: selectedPackageIds,
        priorities,
        tip,
        paymentMethodType: PAYMENT_METHOD_TYPE_MAP[paymentMethod!],
        paymentAccountIdentifier: accountValue.trim() || undefined,
        scopeAnswers: draft.scopeAnswers,
        issuePhotoUrls: draft.issuePhotoUrls,
        idempotencyKey,
      });

      const createdBooking: Booking = {
        id: response.id,
        service: draft.category || draft.serviceType || "Service",
        worker: response.workerName ?? "To be assigned",
        workerId: response.workerName ? (draft.workerId ?? undefined) : undefined,
        date: response.scheduledDate,
        time: response.scheduledTime,
        isRush: response.isRush,
        address: draft.address || undefined,
        status: "Pending",
        amount: response.pricing?.finalEstimate ?? response.estimatedPrice ?? draft.estimatedPrice ?? 0,
        category: draft.category ?? undefined,
        priceBreakdown: response.pricing
          ? {
              basePrice: response.pricing.basePrice,
              distanceFee: response.pricing.distanceFee,
              tierFee: response.pricing.tierFee,
              rushFee: response.pricing.rushFee,
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

      setBookingCreated(createdBooking);
      feedback.success();
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
      <KeyboardAwareScrollView className="flex-1" contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
        <StepperHorizontal steps={BOOKING_STEPS} currentStep={2} />

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
              <Text className="text-error font-bold text-sm">This date is no longer available</Text>
              <Text className="text-error text-xs mt-0.5">
                {draft.isAutoMatched
                  ? "No worker is available on this date anymore."
                  : `${draft.workerName ?? "This worker"} is no longer available on this date.`}
              </Text>
              <View className="mt-2.5">
                <OutlinedButton
                  label="Change date"
                  onPress={() => router.push("/(client)/booking/new/step-2")}
                />
              </View>
            </View>
          </View>
        )}

        {isFollowUp && (
          <View className="bg-accent/10 rounded-2xl p-3.5 mb-4 flex-row items-start">
            <Ionicons name="git-branch-outline" size={18} color={colors.accent.DEFAULT} style={{ marginTop: 1 }} />
            <Text className="text-text-secondary text-xs ml-2.5 flex-1">
              Follow-up job for your inspection with {draft.workerName ?? "your worker"}. It&apos;s a separate job with its
              own price, and your worker can accept or decline it.
            </Text>
          </View>
        )}

        {/* Booking summary */}
        <View className="bg-card rounded-2xl p-4">
          <SummaryRow
            label="Service"
            value={[draft.category, draft.selectedTaskName].filter(Boolean).join(" · ") || "—"}
          />
          {!!scopeAnswersSummary && <SummaryRow label="Details" value={scopeAnswersSummary} />}
          {!!draft.description?.trim() && <SummaryRow label="Notes" value={draft.description.trim()} />}
          {(draft.issuePhotoUrls?.length ?? 0) > 0 && (
            <SummaryRow
              label="Photos"
              value={`${draft.issuePhotoUrls!.length} added`}
            />
          )}
          {hasPets && <SummaryRow label="Pets" value="Yes, pet-friendly worker" />}
          {selectedPackageIds.length > 0 && (
            <SummaryRow
              label="Packages"
              value={`${selectedPackageIds.length} selected${packagesTotal > 0 ? ` · ₱${packagesTotal.toFixed(2)}` : ""}`}
            />
          )}
          <SummaryRow
            label="When"
            value={`${draft.date ?? "—"} · ${draft.time ? formatTime12h(draft.time) : "—"}${isRush ? " · Same-day" : ""}`}
          />
          <SummaryRow label="Where" value={draft.address || "—"} />
          <View className="flex-row justify-between items-center">
            <Text className="text-text-secondary text-base">Worker</Text>
            <View className="flex-1 flex-row justify-end items-center ml-3">
              <Text className="text-text-primary text-base font-medium text-right flex-shrink" numberOfLines={1}>
                {draft.isAutoMatched ? "Best available" : draft.workerName || "—"}
              </Text>
              {!draft.workerLocked && !isFollowUp && (
                <Pressable
                  accessibilityRole="button"
                  hitSlop={12}
                  onPress={() => router.push("/(client)/booking/new/step-3")}
                  style={{ minHeight: 44, justifyContent: "center", marginLeft: 12 }}
                >
                  <Text className="text-accent font-bold text-base">Change</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>

        <View className="mt-4">
          <PricingRangePreview estimate={priceEstimate} />
        </View>

        <Text className="text-text-primary font-bold text-base mb-2 mt-6">How will you pay?</Text>
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

        <Text className="text-text-secondary text-sm mt-2">
          You pay after the job is done. Nothing is charged now, and you can cancel for free until a worker confirms.
        </Text>

        <Text className="text-text-primary font-bold text-base mb-2 mt-6">Add a tip (optional)</Text>
        <TipSlider value={tip} onChange={updateTip} />
      </KeyboardAwareScrollView>
      <BookingFooterBar
        estimate={priceEstimate}
        buttonLabel="Book Now"
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
    </SafeAreaView>
  );
}

function SummaryRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View className={`flex-row justify-between ${last ? "" : "mb-3"}`}>
      <Text className="text-text-secondary text-base">{label}</Text>
      <Text className="text-text-primary text-base font-medium flex-1 text-right ml-3" numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}
