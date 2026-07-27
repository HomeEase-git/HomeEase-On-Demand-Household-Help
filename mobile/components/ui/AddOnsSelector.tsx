import React, { useMemo } from "react";
import { View, Text, FlatList, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../constants";

export interface AddOn {
  id: string;
  name: string;
  description: string;
  price: number;
}

interface AddOnsSelectorProps {
  addOns: AddOn[];
  selectedIds: string[];
  onSelectionChange: (selectedIds: string[]) => void;
  showPriceImpact?: boolean;
}

/**
 * Enhanced Add-ons Selector Component
 * Shows add-ons with real-time price updates
 */
export default function AddOnsSelector({
  addOns,
  selectedIds,
  onSelectionChange,
  showPriceImpact = true,
}: AddOnsSelectorProps) {
  // Calculate total price impact
  const totalAddOnPrice = useMemo(() => {
    return addOns
      .filter((a) => selectedIds.includes(a.id))
      .reduce((sum, a) => sum + a.price, 0);
  }, [addOns, selectedIds]);

  const handleToggle = (id: string) => {
    const isSelected = selectedIds.includes(id);
    const updated = isSelected
      ? selectedIds.filter((sid) => sid !== id)
      : [...selectedIds, id];
    onSelectionChange(updated);
  };

  if (addOns.length === 0) {
    return (
      <View className="bg-card rounded-2xl p-4 items-center justify-center py-8">
        <Ionicons name="checkmark-done" size={32} color={colors.text.muted} />
        <Text className="text-text-secondary text-sm mt-2">
          No add-ons available
        </Text>
      </View>
    );
  }

  return (
    <View>
      <View className="flex-row items-center justify-between mb-3">
        <View>
          <Text className="text-text-primary font-bold text-sm">
            Add-ons (Optional)
          </Text>
          <Text className="text-text-secondary text-xs mt-1">
            {selectedIds.length} selected
          </Text>
        </View>
        {showPriceImpact && totalAddOnPrice > 0 && (
          <View className="bg-accent/10 rounded-lg px-3 py-2">
            <Text className="text-accent font-bold text-sm">
              +₱{totalAddOnPrice}
            </Text>
          </View>
        )}
      </View>

      <FlatList
        scrollEnabled={false}
        data={addOns}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const isSelected = selectedIds.includes(item.id);
          return (
            <Pressable
              className={`bg-card rounded-xl p-3 mb-2 flex-row items-center border-2 ${
                isSelected ? "border-accent bg-accent/5" : "border-card-dark"
              }`}
              onPress={() => handleToggle(item.id)}
            >
              {/* Checkbox */}
              <View
                className={`w-5 h-5 rounded border-2 mr-3 items-center justify-center ${
                  isSelected ? "bg-accent border-accent" : "border-text-muted"
                }`}
              >
                {isSelected && (
                  <Ionicons name="checkmark" size={14} color={colors.white} />
                )}
              </View>

              {/* Content */}
              <View className="flex-1">
                <Text
                  className={`font-semibold ${isSelected ? "text-accent" : "text-brand"}`}
                >
                  {item.name}
                </Text>
                <Text className="text-text-secondary text-xs mt-0.5">
                  {item.description}
                </Text>
              </View>

              {/* Price */}
              <View className="items-end ml-2">
                <Text className="text-accent font-semibold text-sm">
                  +₱{item.price}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />

      {/* Summary Card */}
      {selectedIds.length > 0 && showPriceImpact && (
        <View className="bg-accent/10 rounded-xl p-3 mt-2 flex-row items-center justify-between">
          <View>
            <Text className="text-text-secondary text-xs">Add-ons Total</Text>
            <Text className="text-accent font-bold text-base mt-0.5">
              ₱{totalAddOnPrice}
            </Text>
          </View>
          <Ionicons
            name="checkmark-circle"
            size={24}
            color={colors.accent.DEFAULT}
          />
        </View>
      )}
    </View>
  );
}
