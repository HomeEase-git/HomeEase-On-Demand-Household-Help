import React, { useState } from "react";
import { View, Text, Pressable } from "react-native";
import BottomSheetWrapper, { BottomSheetHandle } from "./BottomSheetWrapper";
import PrimaryButton from "../ui/PrimaryButton";
import { categories } from "../../constants/dummyData";

export type SortOption = "rating" | "priceLow" | "priceHigh" | "nearest";

export type SearchFilters = {
  sort: SortOption;
  availableOnly: boolean;
};

const DEFAULT_FILTERS: SearchFilters = { sort: "rating", availableOnly: false };

type Props = {
  innerRef: React.RefObject<BottomSheetHandle | null>;
  value?: SearchFilters;
  onApply?: (filters: SearchFilters) => void;
  showNearest?: boolean;
};

export const FilterSortBottomSheet: React.FC<Props> = ({
  innerRef,
  value = DEFAULT_FILTERS,
  onApply,
  showNearest = false,
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
      <Text className="text-brand text-sm mb-2">Sort by</Text>
      <View className="flex-row flex-wrap gap-2 mb-4">
        {[
          { value: "rating" as const, label: "Rating" },
          { value: "priceLow" as const, label: "Price Low-High" },
          { value: "priceHigh" as const, label: "Price High-Low" },
          ...(showNearest ? [{ value: "nearest" as const, label: "Nearest (10km)" }] : []),
        ].map((opt) => (
          <Pressable
            key={opt.value}
            className={`px-3 py-2 rounded-xl ${
              sort === opt.value ? "bg-accent" : "bg-card-light"
            }`}
            onPress={() => setSort(opt.value)}
          >
            <Text
              className={
                sort === opt.value ? "text-white font-semibold" : "text-brand"
              }
            >
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <View className="flex-row items-center justify-between mb-6">
        <Text className="text-brand">Available only</Text>
        <Pressable
          className={`w-12 h-7 rounded-full ${
            availableOnly ? "bg-accent" : "bg-card-light"
          }`}
          onPress={() => setAvailableOnly((v) => !v)}
        >
          <View
            className={`w-5 h-5 rounded-full bg-card mt-1 ${
              availableOnly ? "ml-6" : "ml-1"
            }`}
          />
        </Pressable>
      </View>
      <PrimaryButton label="Apply" fullWidth onPress={handleApply} />
      <Pressable className="mt-3" onPress={handleReset}>
        <Text className="text-brand text-center">Reset</Text>
      </Pressable>
    </BottomSheetWrapper>
  );
};

export default FilterSortBottomSheet;
