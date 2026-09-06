import React, { useState } from "react";
import { View, Text, Pressable } from "react-native";
import BottomSheetWrapper, { BottomSheetHandle } from "./BottomSheetWrapper";
import PrimaryButton from "../ui/PrimaryButton";
import OutlinedButton from "../ui/OutlinedButton";
import { cardShadow } from "../../constants";

export type SortOption = "rating" | "priceLow" | "priceHigh";

export type SearchFilters = {
  sort: SortOption;
  availableOnly: boolean;
};

const DEFAULT_FILTERS: SearchFilters = { sort: "rating", availableOnly: false };

type Props = {
  innerRef: React.RefObject<BottomSheetHandle | null>;
  value?: SearchFilters;
  onApply?: (filters: SearchFilters) => void;
};

export const FilterSortBottomSheet: React.FC<Props> = ({
  innerRef,
  value = DEFAULT_FILTERS,
  onApply,
}) => {
  const [sort, setSort] = useState<SortOption>(value.sort);
  const [availableOnly, setAvailableOnly] = useState(value.availableOnly);
  const [prevValue, setPrevValue] = useState(value);

  if (value.sort !== prevValue.sort || value.availableOnly !== prevValue.availableOnly) {
    setPrevValue(value);
    setSort(value.sort);
    setAvailableOnly(value.availableOnly);
  }

  const handleApply = () => {
    onApply?.({ sort, availableOnly });
    innerRef.current?.close();
  };

  const handleReset = () => {
    setSort("rating");
    setAvailableOnly(false);
    onApply?.({ sort: "rating", availableOnly: false });
    innerRef.current?.close();
  };

  return (
    <BottomSheetWrapper
      innerRef={innerRef}
      snapPoints={["60%"]}
      title="Filter & Sort"
    >
      <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide mb-2">
        Sort by
      </Text>
      <View className="flex-row flex-wrap gap-2 mb-5">
        {[
          { value: "rating" as const, label: "Rating" },
          { value: "priceLow" as const, label: "Price Low-High" },
          { value: "priceHigh" as const, label: "Price High-Low" },
        ].map((opt) => (
          <Pressable
            key={opt.value}
            className={`px-3 py-2 rounded-full ${
              sort === opt.value ? "bg-accent" : "bg-white"
            }`}
            style={sort === opt.value ? undefined : cardShadow}
            onPress={() => setSort(opt.value)}
          >
            <Text
              className={
                sort === opt.value ? "text-white font-semibold" : "text-text-primary"
              }
            >
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <View
        className="flex-row items-center justify-between bg-white rounded-2xl px-4 py-3.5 mb-6"
        style={cardShadow}
      >
        <Text className="text-text-primary">Available only</Text>
        <Pressable
          className={`w-12 h-7 rounded-full ${
            availableOnly ? "bg-brand" : "bg-neutral-300"
          }`}
          onPress={() => setAvailableOnly((v) => !v)}
        >
          <View
            className={`w-5 h-5 rounded-full bg-white mt-1 ${
              availableOnly ? "ml-6" : "ml-1"
            }`}
          />
        </Pressable>
      </View>
      <PrimaryButton label="Apply" fullWidth onPress={handleApply} />
      <View className="mt-3">
        <OutlinedButton label="Reset" fullWidth onPress={handleReset} />
      </View>
    </BottomSheetWrapper>
  );
};

export default FilterSortBottomSheet;
