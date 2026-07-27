import React, { useState } from "react";
import { View, Text, TextInput, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import * as api from "../../../../services/api";
import { serviceConfigs } from "../../../../constants/serviceData";
import { useBookingStore, type Booking } from "../../../../store/bookingStore";
import { colors } from "../../../../constants";

export default function PaymentScreen() {
  const router = useRouter();
  const draft = useBookingStore((s) => s.draft);
  const setBookingCreated = useBookingStore((s) => s.setBookingCreated);
  const [accountValue, setAccountValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const method = draft.paymentMethod;

  const methodLabel =
    method === "gcash"
      ? "GCash"
      : method === "maya"
        ? "Maya"
        : method === "bank"
          ? "Bank Transfer"
          : method === "cash"
            ? "Cash"
            : null;

  const baseAmount = draft.estimatedPrice || 0;
  const TAX_RATE = 0.12;
  const taxAmount = parseFloat((baseAmount * TAX_RATE).toFixed(2));
  const serviceFee = parseFloat((baseAmount * 0.1).toFixed(2));
  const tip = draft.tip ?? 0;
  const total = parseFloat(
    (baseAmount + taxAmount + serviceFee + tip).toFixed(2),
  );

  const handleSubmit = async () => {
    if (!method) {
      Alert.alert("Payment method", "Please select a payment method first.");
      router.back();
      return;
    }

    if (!baseAmount) {
      Alert.alert(
        "Booking error",
        "Missing service price. Please return and finish your booking.",
      );
      router.back();
      return;
    }

    const requiresInput =
      method === "gcash" || method === "maya" || method === "bank";
    if (requiresInput && !accountValue.trim()) {
      Alert.alert(
        "Payment details",
        "Please enter the required payment details for this method.",
      );
      return;
    }

    try {
      setSubmitting(true);

      if (!draft.workerId || !draft.selectedTaskId || !draft.date) {
        Alert.alert(
          "Booking error",
          "Incomplete booking details. Please return and finish your booking.",
        );
        router.back();
        return;
      }

      const addOns = (draft.selectedAddOnIds || []).flatMap((id) => {
        const category = serviceConfigs.find(
          (c) =>
            c.categoryName.toLowerCase() ===
            (draft.category || "").toLowerCase(),
        );
        const found = category?.addOns.find((a) => a.id === id);
        return found
          ? [{ id: found.id, name: found.name, price: found.price }]
          : [];
      });

      const bookingPayload = {
        workerId: draft.workerId,
        serviceTaskId: draft.selectedTaskId,
        location: draft.address || "",
        city: draft.city || "",
        scheduledDate: draft.date,
        scheduledTime: draft.time || "",
        description: draft.description || draft.category || "",
        notes: draft.notes || draft.instructions || "",
        estimatedPrice: draft.estimatedPrice || 0,
        tip: draft.tip || 0,
        addOns,
      };

      const response = await api.createBooking(bookingPayload);

      // The API only returns a partial payload (id, clientName, workerName,
      // scheduledDate, ...) - normalize it into the shape the store/UI expect
      // (date, worker, service, amount) before saving, otherwise screens that
      // read booking.amount/date directly (payment success, booking detail) crash.
      const createdBooking: Booking = {
        id: response.id,
        service: draft.category || "Service",
        worker: response.workerName ?? "Unassigned",
        workerId: draft.workerId ?? undefined,
        date: response.scheduledDate ?? bookingPayload.scheduledDate,
        time: response.scheduledTime || undefined,
        address: draft.address || undefined,
        status: "Pending",
        amount: total,
        payment: { methodType: method ?? "CASH" },
        category: draft.category ?? undefined,
        selectedTaskId: draft.selectedTaskId ?? undefined,
        selectedAddOnIds: draft.selectedAddOnIds,
      };

      setBookingCreated(createdBooking);
      router.replace("/(client)/booking/payment/success");
    } catch (e) {
      console.error("Payment/create booking failed:", e);
      Alert.alert(
        "Payment failed",
        "Unable to complete your booking. Please try again.",
      );
      router.replace("/(client)/booking/payment/failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 24, paddingBottom: 40 }}
      >
        <Text className="text-text-primary text-2xl font-bold mb-4">Payment</Text>

        <View className="bg-card rounded-2xl p-4 mb-4">
          <Text className="text-brand font-semibold mb-1">
            Booking Summary
          </Text>
          <Text className="text-text-secondary text-sm">
            Service: {draft.category ?? "Selected service"}
          </Text>
          <Text className="text-text-secondary text-sm">
            Address: {draft.address ?? "Selected address"}
          </Text>
          <Text className="text-text-secondary text-sm">
            Date: {draft.date ?? "Date"} · Time: {draft.time ?? "Time"}
          </Text>
          <View className="mt-3">
            <View className="flex-row justify-between items-center mb-1">
              <Text className="text-text-secondary text-sm">Subtotal</Text>
              <Text className="text-brand text-sm">₱{baseAmount}.00</Text>
            </View>
            <View className="flex-row justify-between items-center mb-1">
              <Text className="text-text-secondary text-sm">VAT (12%)</Text>
              <Text className="text-brand text-sm">₱{taxAmount}</Text>
            </View>
            <View className="flex-row justify-between items-center mb-1">
              <Text className="text-text-secondary text-sm">
                Platform Fee (10%)
              </Text>
              <Text className="text-brand text-sm">₱{serviceFee}</Text>
            </View>
            {tip > 0 && (
              <View className="flex-row justify-between items-center mb-1">
                <Text className="text-text-secondary text-sm">Tip</Text>
                <Text className="text-brand text-sm">₱{tip}.00</Text>
              </View>
            )}
            <View className="border-b border-divider my-2" />
            <View className="flex-row justify-between items-center">
              <Text className="text-text-primary font-bold text-base">Total</Text>
              <Text className="text-accent font-bold text-lg">₱{total}</Text>
            </View>
          </View>
        </View>

        <View className="bg-card rounded-2xl p-4 mb-4">
          <Text className="text-text-secondary text-sm">Payment Method</Text>
          <Text className="text-brand font-semibold mt-1">
            {methodLabel ?? "Not selected"}
          </Text>
        </View>

        {method === "gcash" && (
          <View className="bg-card rounded-2xl p-4 mb-4">
            <Text className="text-brand font-semibold mb-2">
              GCash Details
            </Text>
            <Text className="text-text-secondary text-xs mb-2">
              Enter the mobile number linked to your GCash account.
            </Text>
            <TextInput
              className="bg-card-dark rounded-xl px-3 py-2 text-brand"
              placeholder="09XXXXXXXXX"
              placeholderTextColor={colors.text.secondary}
              keyboardType="phone-pad"
              value={accountValue}
              onChangeText={setAccountValue}
            />
          </View>
        )}

        {method === "maya" && (
          <View className="bg-card rounded-2xl p-4 mb-4">
            <Text className="text-brand font-semibold mb-2">
              Maya Details
            </Text>
            <Text className="text-text-secondary text-xs mb-2">
              Enter the mobile number linked to your Maya account.
            </Text>
            <TextInput
              className="bg-card-dark rounded-xl px-3 py-2 text-brand"
              placeholder="09XXXXXXXXX"
              placeholderTextColor={colors.text.secondary}
              keyboardType="phone-pad"
              value={accountValue}
              onChangeText={setAccountValue}
            />
          </View>
        )}

        {method === "bank" && (
          <View className="bg-card rounded-2xl p-4 mb-4">
            <Text className="text-brand font-semibold mb-2">
              Bank Transfer Details
            </Text>
            <Text className="text-text-secondary text-xs mb-2">
              Enter the reference or account number you&apos;ll use for the
              transfer.
            </Text>
            <TextInput
              className="bg-card-dark rounded-xl px-3 py-2 text-brand"
              placeholder="Reference / Account Number"
              placeholderTextColor={colors.text.secondary}
              value={accountValue}
              onChangeText={setAccountValue}
            />
          </View>
        )}

        {method === "cash" && (
          <View className="bg-card rounded-2xl p-4 mb-4">
            <Text className="text-brand font-semibold mb-2">
              Cash Payment
            </Text>
            <Text className="text-text-secondary text-xs">
              You&apos;ll pay the worker in cash after the service is completed.
            </Text>
          </View>
        )}

        <View className="mt-4 gap-3">
          <PrimaryButton
            label="Confirm & Pay"
            fullWidth
            loading={submitting}
            disabled={submitting || !method}
            onPress={handleSubmit}
          />
          <OutlinedButton
            label="Back to Review"
            onPress={() => router.back()}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
