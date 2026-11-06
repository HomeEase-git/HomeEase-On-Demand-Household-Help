import React from "react";
import { View, Text } from "react-native";
import type { BookingPriceEstimate } from "../../hooks/useBookingPriceEstimate";

type Props = {
  estimate: BookingPriceEstimate;
};

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
              ? "Exact price is shown once you pick a time and worker"
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
                Skilled tier ₱{Math.round(priceBreakdown.tierFee)}
              </Text>
            )}
            {(priceBreakdown.rushFee ?? 0) > 0 && (
              <Text className="text-white/60 text-xs">
                Rush ₱{Math.round(priceBreakdown.rushFee ?? 0)}
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
