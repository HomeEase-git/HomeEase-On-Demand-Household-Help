import React, { useState } from "react";
import { View, Text, FlatList, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import AddressCard from "../../../../components/cards/AddressCard";
import EmptyState from "../../../../components/feedback/EmptyState";
import { colors } from "../../../../constants";
import * as api from "../../../../services/api";

type Address = {
  id: string;
  label: string;
  street: string;
  city: string;
  state: string;
  zipCode: string;
  isDefault?: boolean;
};

export default function AddressesScreen() {
  const router = useRouter();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAddresses = async () => {
    setLoading(true);
    try {
      const data = await api.getAddresses();
      setAddresses(data);
    } catch (error) {
      console.error("Load addresses error:", error);
      Alert.alert("Error", "Failed to load addresses");
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    React.useCallback(() => {
      loadAddresses();
    }, []),
  );

  const handleDelete = async (id: string) => {
    Alert.alert(
      "Delete address?",
      "This will remove the address from your saved list.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await api.deleteAddress(id);
              setAddresses((prev) => prev.filter((a) => a.id !== id));
            } catch (error) {
              console.error("Delete address error:", error);
              Alert.alert("Error", "Unable to delete address right now.");
            }
          },
        },
      ],
    );
  };

  const handleSetDefault = async (id: string) => {
    try {
      await api.setDefaultAddress(id);
      setAddresses((prev) =>
        prev.map((a) => ({ ...a, isDefault: a.id === id })),
      );
    } catch (error) {
      console.error("Set default address error:", error);
      Alert.alert("Error", "Unable to set default address.");
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-primary-white">
      <ScreenHeader title="My Addresses" showBack />
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-text-secondary">Loading addresses...</Text>
        </View>
      ) : addresses.length === 0 ? (
        <EmptyState
          title="No saved addresses"
          subtitle="Add an address to make booking faster."
          actionLabel="Add Address"
          onAction={() => router.push("/(client)/profile/addresses/new")}
        />
      ) : (
        <FlatList
          data={addresses}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
          renderItem={({ item }) => (
            <AddressCard
              address={{
                id: item.id,
                label: item.label,
                address: `${item.street}, ${item.city}, ${item.state} ${item.zipCode}`,
                isDefault: item.isDefault,
              }}
              onEdit={() =>
                router.push(`/(client)/profile/addresses/${item.id}`)
              }
              onDelete={() => handleDelete(item.id)}
            />
          )}
        />
      )}
      <Pressable
        className="absolute bottom-6 right-6 w-14 h-14 bg-accent rounded-full items-center justify-center"
        onPress={() => router.push("/(client)/profile/addresses/new")}
      >
        <Ionicons name="add" size={28} color={colors.white} />
      </Pressable>
    </SafeAreaView>
  );
}
