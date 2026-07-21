import React, { useEffect, useState } from "react";
import { View, Text, FlatList, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import PaymentMethodCard from "../../../../components/cards/PaymentMethodCard";
import EmptyState from "../../../../components/feedback/EmptyState";
import { colors } from "../../../../constants";
import * as api from "../../../../services/api";

type PaymentMethod = {
  id: string;
  type: "card" | "gcash" | "maya" | "bank";
  lastFour: string;
  label?: string;
  isDefault: boolean;
  expiryDate?: string;
};

export default function PaymentMethodsScreen() {
  const router = useRouter();
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);

  const loadMethods = async () => {
    setLoading(true);
    try {
      const data = await api.getPaymentMethods();
      const mapped = data.map((m: any) => ({
        id: m.id,
        type: m.type.toLowerCase() as "card" | "gcash" | "maya" | "bank",
        lastFour: m.accountIdentifier?.slice(-4) || "XXXX",
        label: m.label,
        isDefault: m.isDefault,
      }));
      setMethods(mapped);
    } catch (error) {
      console.error("Load payment methods error:", error);
      Alert.alert("Error", "Failed to load payment methods");
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
    Alert.alert(
      "Delete payment method?",
      "This will remove it from your saved payment methods.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await api.deletePaymentMethod(id);
              setMethods((prev) => prev.filter((m) => m.id !== id));
            } catch (error) {
              console.error("Delete payment method error:", error);
              Alert.alert(
                "Error",
                "Unable to delete payment method right now.",
              );
            }
          },
        },
      ],
    );
  };

  const handleSetDefault = async (id: string) => {
    try {
      await api.setDefaultPaymentMethod(id);
      setMethods((prev) => prev.map((m) => ({ ...m, isDefault: m.id === id })));
    } catch (error) {
      console.error("Set default payment method error:", error);
      Alert.alert("Error", "Unable to update the default payment method.");
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-primary-white">
      <ScreenHeader title="Payment Methods" showBack />
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-text-secondary">
            Loading payment methods...
          </Text>
        </View>
      ) : methods.length === 0 ? (
        <EmptyState
          title="No payment methods"
          subtitle="Add a card, wallet, or bank account to pay for bookings."
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
        onPress={() => router.push("/(client)/profile/payment-methods/new")}
      >
        <Ionicons name="add" size={28} color={colors.white} />
      </Pressable>
    </SafeAreaView>
  );
}
