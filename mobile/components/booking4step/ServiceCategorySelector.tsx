import React from "react";
import { View, Text, Pressable } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { colors } from "../../constants";
import type { ServiceScopeType, ScopeField } from "../../types/booking4step.types";

export type ServiceCategoryOption = {
  id: string;
  name: string;
  basePrice: number;
  description?: string | null;
  scopeType: ServiceScopeType;
  hasCondition: boolean;
  scopeFields: ScopeField[];
};

// Best-effort icon per category name — falls back to a generic icon for
// whatever else is seeded (categories are DB-driven via GET /services, not
// hardcoded, so this can't be an exhaustive map).
const CATEGORY_ICONS: Record<string, string> = {
  "standard clean": "sparkles-outline",
  "deep clean": "water-outline",
  handyman: "hammer-outline",
  "heavy lifting": "barbell-outline",
  cleaning: "sparkles-outline",
  plumbing: "water-outline",
  electrical: "flash-outline",
  aircon: "snow-outline",
  carpentry: "hammer-outline",
};

function iconFor(name: string): string {
  return CATEGORY_ICONS[name.toLowerCase()] ?? "construct-outline";
}

type Props = {
  categories: ServiceCategoryOption[];
  selectedId: string | null;
  onSelect: (category: ServiceCategoryOption) => void;
  loading?: boolean;
};

/** Grid-style service category picker (Step 1: SCOPE). */
export default function ServiceCategorySelector({ categories, selectedId, onSelect, loading }: Props) {
  if (loading) {
    return (
      <View className="flex-row flex-wrap -mx-1.5">
        {[0, 1, 2, 3].map((i) => (
          <View key={i} className="w-1/2 px-1.5 mb-3">
            <View className="bg-card rounded-2xl h-28 opacity-50" />
          </View>
        ))}
      </View>
    );
  }

  return (
    <View className="flex-row flex-wrap -mx-1.5" accessibilityRole="radiogroup">
      {categories.map((cat) => {
        const isSelected = cat.id === selectedId;
        return (
          <View key={cat.id} className="w-1/2 px-1.5 mb-3">
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              onPress={() => onSelect(cat)}
              className={`rounded-2xl p-4 h-28 justify-between border-2 ${
                isSelected ? "bg-accent/10 border-accent" : "bg-card border-transparent"
              }`}
            >
              <Ionicons
                name={iconFor(cat.name) as any}
                size={26}
                color={isSelected ? colors.accent.DEFAULT : colors.text.secondary}
              />
              <View>
                <Text
                  className={`font-bold text-sm ${isSelected ? "text-accent" : "text-text-primary"}`}
                  numberOfLines={1}
                >
                  {cat.name}
                </Text>
                <Text className="text-text-muted text-xs mt-0.5">from ₱{cat.basePrice}</Text>
              </View>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}
