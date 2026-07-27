import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { PriceBreakdown, formatPrice } from "../../utils/pricing";
import { colors } from "../../constants";

interface PriceBreakdownCardProps {
  breakdown: PriceBreakdown;
  detailed?: boolean; // If true, show all details; if false, show compact view
}

/**
 * PriceBreakdownCard Component
 * Displays a detailed or compact breakdown of booking costs
 */
export default function PriceBreakdownCard({
  breakdown,
  detailed = true,
}: PriceBreakdownCardProps) {
  if (!detailed) {
    // Compact view - just show total
    return (
      <View className="bg-card rounded-2xl p-4 flex-row items-center justify-between border border-accent/20">
        <View>
          <Text className="text-text-secondary text-xs">Estimated Total</Text>
          <Text className="text-accent text-xl font-bold mt-1">
            {formatPrice(
              breakdown.subtotal +
                breakdown.tax +
                breakdown.commission +
                breakdown.tip,
            )}
          </Text>
        </View>
        <Ionicons name="receipt" size={24} color={colors.accent.DEFAULT} />
      </View>
    );
  }

  // Detailed view
  return (
    <View className="bg-card rounded-2xl p-4">
      <View className="flex-row items-center justify-between mb-3 pb-3 border-b border-card-dark">
        <Text className="text-text-primary font-bold text-lg">Price Breakdown</Text>
        <Ionicons
          name="receipt-outline"
          size={20}
          color={colors.accent.DEFAULT}
        />
      </View>

      {/* Base Price */}
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-text-secondary text-sm">Service (Base)</Text>
        <Text className="text-brand font-semibold">
          {formatPrice(breakdown.basePrice)}
        </Text>
      </View>

      {/* Duration Cost */}
      {breakdown.durationHours > 1 && breakdown.durationCost > 0 && (
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-text-secondary text-sm">
            Additional ({breakdown.durationHours - 1}h
            {breakdown.durationHours - 1 > 1 ? "s" : ""})
          </Text>
          <Text className="text-brand font-semibold">
            {formatPrice(breakdown.durationCost)}
          </Text>
        </View>
      )}

      {/* Add-ons */}
      {breakdown.addOnsTotal > 0 && (
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-text-secondary text-sm">Add-ons</Text>
          <Text className="text-brand font-semibold">
            {formatPrice(breakdown.addOnsTotal)}
          </Text>
        </View>
      )}

      {/* Subtotal */}
      <View className="flex-row items-center justify-between mb-3 pb-3 border-b border-card-dark">
        <Text className="text-text-secondary text-sm font-semibold">
          Subtotal
        </Text>
        <Text className="text-text-primary font-bold">
          {formatPrice(breakdown.subtotal)}
        </Text>
      </View>

      {/* Tax */}
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center">
          <Text className="text-text-secondary text-sm">Tax (12%)</Text>
        </View>
        <Text className="text-brand font-semibold">
          {formatPrice(breakdown.tax)}
        </Text>
      </View>

      {/* Commission */}
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center">
          <Text className="text-text-secondary text-sm">
            Platform Fee (10%)
          </Text>
          <Ionicons
            name="information-circle-outline"
            size={14}
            color={colors.text.muted}
            style={{ marginLeft: 4 }}
          />
        </View>
        <Text className="text-brand font-semibold">
          {formatPrice(breakdown.commission)}
        </Text>
      </View>

      {/* Tip */}
      {breakdown.tip > 0 && (
        <View className="flex-row items-center justify-between mb-3 pb-3 border-b border-card-dark">
          <Text className="text-text-secondary text-sm">Tip</Text>
          <Text className="text-accent font-semibold">
            +{formatPrice(breakdown.tip)}
          </Text>
        </View>
      )}

      {/* Total */}
      <View className="flex-row items-center justify-between bg-accent/10 rounded-xl p-3 -mx-4 px-4">
        <View>
          <Text className="text-text-secondary text-xs">Total Amount</Text>
          <Text className="text-accent font-bold text-lg mt-1">
            {formatPrice(breakdown.total)}
          </Text>
        </View>
        <View className="w-12 h-12 rounded-full bg-accent/20 items-center justify-center">
          <Ionicons name="checkmark" size={24} color={colors.accent.DEFAULT} />
        </View>
      </View>
    </View>
  );
}
