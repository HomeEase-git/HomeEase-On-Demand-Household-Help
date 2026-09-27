import React, { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { colors } from "../../constants";

export type SelectDropdownItem = {
  id: string;
  label: string;
  /** Price line, shown under the label when present. */
  price?: string | null;
  description?: string | null;
  icon?: string | null;
};

type Props = {
  items: SelectDropdownItem[];
  selectedId: string | null;
  placeholder: string;
  onSelect: (id: string) => void;
  loading?: boolean;
  accessibilityLabel?: string;
};

function ItemBody({ item, highlighted }: { item: SelectDropdownItem; highlighted: boolean }) {
  return (
    <View className="flex-row items-center flex-1">
      {!!item.icon && (
        <View className="mr-3">
          <Ionicons
            name={item.icon as any}
            size={22}
            color={highlighted ? colors.accent.DEFAULT : colors.text.secondary}
          />
        </View>
      )}
      <View className="flex-1 pr-2">
        <Text
          className={`font-semibold text-sm ${highlighted ? "text-accent" : "text-text-primary"}`}
          numberOfLines={1}
        >
          {item.label}
        </Text>
        {!!item.description && (
          <Text className="text-text-muted text-xs mt-0.5" numberOfLines={2}>
            {item.description}
          </Text>
        )}
        {!!item.price && <Text className="text-text-secondary text-xs mt-0.5 font-medium">{item.price}</Text>}
      </View>
    </View>
  );
}

/**
 * Collapsible single-select picker (Step 1: SCOPE). The closed state shows
 * the current pick with its icon and price; tapping expands the options
 * inline, so it stays inside the screen's own scroll view.
 */
export default function SelectDropdown({ items, selectedId, placeholder, onSelect, loading, accessibilityLabel }: Props) {
  const [open, setOpen] = useState(false);
  const selected = items.find((i) => i.id === selectedId) ?? null;

  if (loading) {
    return <View className="bg-card rounded-2xl h-16 opacity-50" />;
  }

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? placeholder}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        className={`rounded-2xl p-3.5 border-2 flex-row items-center ${
          open || selected ? "bg-accent/10 border-accent" : "bg-card border-transparent"
        }`}
      >
        {selected ? (
          <ItemBody item={selected} highlighted />
        ) : (
          <Text className="text-text-muted text-sm flex-1">{placeholder}</Text>
        )}
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={20} color={colors.text.secondary} />
      </Pressable>

      {open && (
        <View
          accessibilityRole="radiogroup"
          className="mt-2 rounded-2xl border overflow-hidden bg-white"
          style={{ borderColor: colors.divider }}
        >
          {items.map((item, idx) => {
            const isSelected = item.id === selectedId;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                onPress={() => {
                  setOpen(false);
                  onSelect(item.id);
                }}
                className={`p-3.5 flex-row items-center ${isSelected ? "bg-accent/10" : ""}`}
                style={idx > 0 ? { borderTopWidth: 1, borderTopColor: colors.divider } : undefined}
              >
                <ItemBody item={item} highlighted={isSelected} />
                {isSelected && <Ionicons name="checkmark-circle" size={20} color={colors.accent.DEFAULT} />}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}
