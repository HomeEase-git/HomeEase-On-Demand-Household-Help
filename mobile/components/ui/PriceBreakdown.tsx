import React from "react";
import { View, Text } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { formatPrice } from "../../utils/pricing";
import { colors } from "../../constants";

export interface PriceBreakdownAddOn {
  name: string;
  price: number;
}

interface PriceBreakdownCardProps {
  subtotal: number;
  addOns?: PriceBreakdownAddOn[];
  tip: number;
  total: number;
  detailed?: boolean; // If true, show all details; if false, show compact view
}

/**
 * PriceBreakdownCard Component
 *
 * Renders the booking's real, backend-persisted charge (Payment.subtotal /
 * addOns / tip / totalAmount) — the platform's commission and withholding
 * tax are deducted from the worker's payout, never charged to the client,
 * so they're intentionally not shown here.
 */
export default function PriceBreakdownCard({
  subtotal,
  addOns = [],
  tip,
  total,
  detailed = true,
}: PriceBreakdownCardProps) {
  if (!detailed) {
    return (
      <View className="bg-card rounded-2xl p-4 flex-row items-center justify-between border border-accent/20">
        <View>
          <Text className="text-text-secondary text-xs">Total</Text>
          <Text className="text-accent text-xl font-bold mt-1">
            {formatPrice(total)}
          </Text>
        </View>
        <Ionicons name="receipt" size={24} color={colors.accent.DEFAULT} />
      </View>
    );
  }

  const addOnsTotal = addOns.reduce((sum, a) => sum + a.price, 0);

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

      {/* Subtotal */}
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-text-secondary text-sm">Service</Text>
        <Text className="text-brand font-semibold">
          {formatPrice(subtotal - addOnsTotal)}
        </Text>
      </View>

      {/* Add-ons */}
      {addOns.map((addOn, index) => (
        <View
          key={`${addOn.name}-${index}`}
          className="flex-row items-center justify-between mb-2"
        >
          <Text className="text-text-secondary text-sm">{addOn.name}</Text>
          <Text className="text-brand font-semibold">
            {formatPrice(addOn.price)}
          </Text>
        </View>
      ))}

      {/* Subtotal (with add-ons) */}
      <View className="flex-row items-center justify-between mb-3 pb-3 border-b border-card-dark">
        <Text className="text-text-secondary text-sm font-semibold">
          Subtotal
        </Text>
        <Text className="text-text-primary font-bold">
          {formatPrice(subtotal)}
        </Text>
      </View>

      {/* Tip */}
      {tip > 0 && (
        <View className="flex-row items-center justify-between mb-3 pb-3 border-b border-card-dark">
          <Text className="text-text-secondary text-sm">Tip</Text>
          <Text className="text-accent font-semibold">
            +{formatPrice(tip)}
          </Text>
        </View>
      )}

      {/* Total */}
      <View className="flex-row items-center justify-between bg-accent/10 rounded-xl p-3 -mx-4 px-4">
        <View>
          <Text className="text-text-secondary text-xs">Total Amount</Text>
          <Text className="text-accent font-bold text-lg mt-1">
            {formatPrice(total)}
          </Text>
        </View>
        <View className="w-12 h-12 rounded-full bg-accent/20 items-center justify-center">
          <Ionicons name="checkmark" size={24} color={colors.accent.DEFAULT} />
        </View>
      </View>
    </View>
  );
}
