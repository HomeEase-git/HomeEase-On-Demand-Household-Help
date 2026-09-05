import React, { useState } from "react";
import { View, Text, FlatList, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import PaymentMethodCard from "../../../../components/cards/PaymentMethodCard";
import EmptyState from "../../../../components/feedback/EmptyState";
import { Skeleton } from "../../../../components/ui/Skeleton";
import { colors, cardShadow } from "../../../../constants";
import * as api from "../../../../services/api";
import { useAlertModal } from "../../../../contexts/AlertModalContext";
import type { PaymentMethod } from "../../../../types/api.types";

export default function PaymentMethodsScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);

  const loadMethods = async () => {
    setLoading(true);
    try {
      const data = await api.getPaymentMethods();
      const mapped: PaymentMethod[] = data.map((m: any) => ({
        id: m.id,
        type: m.type.toLowerCase() as PaymentMethod["type"],
        lastFour: m.accountIdentifier?.slice(-4) || "XXXX",
        label: m.label,
        isDefault: m.isDefault,
      }));
      setMethods(mapped);
    } catch (error) {
      console.error("Load payment methods error:", error);
      alertModal.error("Error", "Failed to load payment methods");
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    React.useCallback(() => {
      loadMethods();
    }, []),
  );

  const handleDelete = async (id: string) => {
    alertModal.confirm(
      "Delete payment method?",
      "This will remove it from your saved payment methods.",
      {
        confirmText: "Delete",
        destructive: true,
        onConfirm: async () => {
          try {
            await api.deletePaymentMethod(id);
            setMethods((prev) => prev.filter((m) => m.id !== id));
          } catch (error) {
            console.error("Delete payment method error:", error);
            alertModal.error(
              "Error",
              "Unable to delete payment method right now.",
            );
          }
        },
      },
    );
  };

  const handleSetDefault = async (id: string) => {
    try {
      await api.setDefaultPaymentMethod(id);
      setMethods((prev) => prev.map((m) => ({ ...m, isDefault: m.id === id })));
    } catch (error) {
      console.error("Set default payment method error:", error);
      alertModal.error("Error", "Unable to update the default payment method.");
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Payment Methods" showBack />
      {loading ? (
        <View className="p-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <View key={i} className="bg-card rounded-2xl p-4 mb-3" style={cardShadow}>
              <Skeleton width="40%" height={14} marginBottom={8} />
              <Skeleton width="60%" height={12} marginBottom={0} />
            </View>
          ))}
        </View>
      ) : methods.length === 0 ? (
        <EmptyState
          icon="card-outline"
          title="No payment methods"
          subtitle="Add a wallet or bank account to pay for bookings."
          actionLabel="Add Payment Method"
          onAction={() => router.push("/(client)/profile/payment-methods/new")}
        />
      ) : (
        <FlatList
          data={methods}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
          renderItem={({ item }) => (
            <PaymentMethodCard
              method={item}
              onEdit={() =>
                router.push(`/(client)/profile/payment-methods/${item.id}`)
              }
              onDelete={() => handleDelete(item.id)}
              onSetDefault={() => handleSetDefault(item.id)}
            />
          )}
          ListHeaderComponent={
            methods.length > 0 ? (
              <View className="mb-4">
                <Text className="text-text-secondary text-sm">
                  Default payment method is used for automatic bookings
                </Text>
              </View>
            ) : null
          }
        />
      )}
      <Pressable
        className="absolute bottom-6 right-6 w-14 h-14 bg-accent rounded-full items-center justify-center"
        style={cardShadow}
        onPress={() => router.push("/(client)/profile/payment-methods/new")}
      >
        <Ionicons name="add" size={28} color={colors.white} />
      </Pressable>
    </SafeAreaView>
  );
}
