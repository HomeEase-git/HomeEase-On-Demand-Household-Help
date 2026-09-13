import React from "react";
import { View, Text } from "react-native";
import type { BookingPriceEstimate } from "../../hooks/useBookingPriceEstimate";

type Props = {
  estimate: BookingPriceEstimate;
};

/**
 * Dynamic pricing preview shown in Step 1/2 (category-rate estimate, no
 * worker chosen yet — "range" mode is a legacy name, it renders one
 * approximate price, not a low-high spread) and Step 3/4 (point estimate
 * with the worker's tier surcharge and add-ons factored in, once a worker
 * is picked or auto-match is confirmed). Client-side estimate for
 * responsive UX — see utils/bookingPriceEstimate.ts for why the authoritative
 * price always comes from the backend instead.
 *
 */
export default function PricingRangePreview({ estimate }: Props) {
  if (estimate.mode === "range") {
    const { price } = estimate.range;
    const hasSelection = price > 0;

    return (
      <View className="bg-brand rounded-2xl p-4">
        <Text className="text-white/70 text-xs font-medium">
          Estimated price
        </Text>
        <Text className="text-white font-bold text-2xl mt-0.5">
          {hasSelection ? `~₱${Math.round(price)}` : "—"}
        </Text>
        <Text className="text-white/60 text-xs mt-2">
          {hasSelection
            ? "Exact price shown after you pick a time and worker"
            : "Select a service to see pricing"}
        </Text>
      </View>
    );
  }

  const { total, laborCost, addOnsTotal, tip } = estimate.point;

  return (
    <View className="bg-brand rounded-2xl p-4">
      <Text className="text-white/70 text-xs font-medium">
        Estimated total
      </Text>
      <Text className="text-white font-bold text-2xl mt-0.5">
        ₱{Math.round(total)}
      </Text>
      <View className="flex-row flex-wrap gap-x-4 gap-y-0.5 mt-2">
        <Text className="text-white/60 text-xs">
          Labor ₱{Math.round(laborCost)}
        </Text>
        {addOnsTotal > 0 && (
          <Text className="text-white/60 text-xs">
            Add-ons ₱{Math.round(addOnsTotal)}
          </Text>
        )}
        {tip > 0 && (
          <Text className="text-white/60 text-xs">Tip ₱{Math.round(tip)}</Text>
        )}
      </View>
    </View>
  );
}
