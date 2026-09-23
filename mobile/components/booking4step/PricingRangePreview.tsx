import React from "react";
import { View, Text } from "react-native";
import type { BookingPriceEstimate } from "../../hooks/useBookingPriceEstimate";

type Props = {
  estimate: BookingPriceEstimate;
};

/**
 * Dynamic pricing preview shown in Step 1/2 (a low-high range — the
 * marketplace-wide spread for a category, or a locked worker's own spread
 * for it, since no job-specific number is known yet) and Step 3/4 (an exact
 * point estimate once a specific worker's real computed price is known).
 * Client-side estimate for responsive UX — see utils/bookingPriceEstimate.ts
 * for why the authoritative price always comes from the backend instead.
 */
export default function PricingRangePreview({ estimate }: Props) {
  if (estimate.mode === "range") {
    const { min, max } = estimate.range;
    const hasSelection = max > 0;
    const unitSuffix = estimate.unitLabel ? `/${estimate.unitLabel}` : "";

    return (
      <View className="bg-brand rounded-2xl p-4">
        <Text className="text-white/70 text-xs font-medium">
          {estimate.unitLabel ? "Estimated rate" : "Estimated price"}
        </Text>
        <Text className="text-white font-bold text-2xl mt-0.5">
          {hasSelection
            ? min === max
              ? `~₱${Math.round(min)}${unitSuffix}`
              : `₱${Math.round(min)} – ₱${Math.round(max)}${unitSuffix}`
            : "—"}
        </Text>
        <Text className="text-white/60 text-xs mt-2">
          {estimate.unitLabel
            ? "Enter the quantity above to see the total"
            : hasSelection
              ? "Exact price is shown once you pick a time and pro"
              : "Select a service to see pricing"}
        </Text>
      </View>
    );
  }

  const { total, laborCost, priceBreakdown, addOnsTotal, tip } = estimate.point;

  return (
    <View className="bg-brand rounded-2xl p-4">
      <Text className="text-white/70 text-xs font-medium">
        Estimated total
      </Text>
      <Text className="text-white font-bold text-2xl mt-0.5">
        ₱{Math.round(total)}
      </Text>
      <View className="flex-row flex-wrap gap-x-4 gap-y-0.5 mt-2">
        {priceBreakdown ? (
          <>
            <Text className="text-white/60 text-xs">
              Base rate ₱{Math.round(priceBreakdown.basePrice)}
            </Text>
            {priceBreakdown.distanceFee > 0 && (
              <Text className="text-white/60 text-xs">
                Distance fee ₱{Math.round(priceBreakdown.distanceFee)}
              </Text>
            )}
            {priceBreakdown.tierFee > 0 && (
              <Text className="text-white/60 text-xs">
                Pro tier ₱{Math.round(priceBreakdown.tierFee)}
              </Text>
            )}
          </>
        ) : (
          <Text className="text-white/60 text-xs">
            Labor ₱{Math.round(laborCost)}
          </Text>
        )}
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
