import React from "react";
import { View, Text } from "react-native";
import PrimaryButton from "../ui/PrimaryButton";
import { cardShadow } from "../../constants";
import type { BookingPriceEstimate } from "../../hooks/useBookingPriceEstimate";

const peso = (n: number) => `₱${Math.round(n).toLocaleString("en-PH")}`;

export function formatEstimate(estimate: BookingPriceEstimate): { amount: string; label: string } | null {
  if (estimate.mode === "point") {
    return { amount: peso(estimate.point.total), label: "Estimated total" };
  }
  const { min, max } = estimate.range;
  if (!(max > 0)) return null;
  const unit = estimate.unitLabel ? `/${estimate.unitLabel}` : "";
  return {
    amount: min === max ? `~${peso(min)}${unit}` : `${peso(min)} – ${peso(max)}${unit}`,
    label: estimate.unitLabel ? "Estimated rate" : "Estimated price",
  };
}

type Props = {
  estimate: BookingPriceEstimate | null;
  noPriceText?: string;
  label?: string;
  buttonLabel: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
};

export const BookingFooterBar: React.FC<Props> = ({
  estimate,
  noPriceText = "Price shown once you choose a service",
  label,
  buttonLabel,
  onPress,
  disabled,
  loading,
}) => {
  const formatted = estimate ? formatEstimate(estimate) : null;
  return (
    <View
      className="flex-row items-center bg-white border-t border-divider px-4 pt-3 pb-3"
      style={cardShadow}
    >
      <View className="flex-1 mr-3">
        {formatted ? (
          <>
            <Text className="text-text-secondary text-xs">{label ?? formatted.label}</Text>
            <Text className="text-text-primary text-lg font-bold" numberOfLines={1} adjustsFontSizeToFit>
              {formatted.amount}
            </Text>
          </>
        ) : (
          <Text className="text-text-secondary text-sm">{noPriceText}</Text>
        )}
      </View>
      <View className="w-40">
        <PrimaryButton label={buttonLabel} fullWidth onPress={onPress} disabled={disabled} loading={loading} />
      </View>
    </View>
  );
};

export default BookingFooterBar;
