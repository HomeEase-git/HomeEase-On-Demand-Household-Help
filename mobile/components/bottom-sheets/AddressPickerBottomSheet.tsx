import React from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import BottomSheetWrapper, { BottomSheetHandle } from "./BottomSheetWrapper";
import { colors, cardShadow } from "../../constants";

export type SavedAddress = {
  id: string;
  label: string;
  houseNumber?: string | null;
  street: string;
  barangay?: string | null;
  city: string;
  state: string;
  zipCode: string;
  isDefault?: boolean;
  // Persisted server-side once an address has been geocoded (see
  // backend UserAddress.lat/lng) — the authoritative coordinate source when
  // present, ahead of the on-device cache and a live re-geocode.
  lat?: number | null;
  lng?: number | null;
};

type Props = {
  innerRef: React.RefObject<BottomSheetHandle | null>;
  addresses: SavedAddress[];
  loading: boolean;
  selectedAddressId: string | null;
  resolvingId: string | null;
  onSelect: (address: SavedAddress) => void;
  onAddNew: () => void;
};

export const AddressPickerBottomSheet: React.FC<Props> = ({
  innerRef,
  addresses,
  loading,
  selectedAddressId,
  resolvingId,
  onSelect,
  onAddNew,
}) => {
  return (
    <BottomSheetWrapper innerRef={innerRef} snapPoints={["60%"]} title="Select address">
      {loading ? (
        <View className="py-8 items-center">
          <ActivityIndicator color={colors.brand.DEFAULT} />
        </View>
      ) : addresses.length === 0 ? (
        <Text className="text-text-muted text-sm py-4 text-center">
          No saved addresses yet — add one to get started.
        </Text>
      ) : (
        <ScrollView className="max-h-72" showsVerticalScrollIndicator={false}>
          {addresses.map((item) => {
            const isSelected = selectedAddressId === item.id;
            const isResolving = resolvingId === item.id;

            return (
              <Pressable
                key={item.id}
                disabled={resolvingId != null}
                onPress={() => onSelect(item)}
                className={`bg-white rounded-2xl p-4 mb-2 flex-row items-start border-2 ${
                  isSelected ? "border-accent" : "border-transparent"
                }`}
                style={cardShadow}
              >
                <Ionicons name="location-outline" size={20} color={colors.text.muted} style={{ marginTop: 2 }} />
                <View className="flex-1 ml-3">
                  <View className="flex-row items-center gap-2">
                    <Text className="text-text-primary font-bold">{item.label}</Text>
                    {item.isDefault && (
                      <View className="bg-accent rounded-full px-2 py-0.5">
                        <Text className="text-white text-xs">Default</Text>
                      </View>
                    )}
                  </View>
                  <Text className="text-text-secondary text-sm mt-1">
                    {`${item.street}, ${item.city}, ${item.state} ${item.zipCode}`}
                  </Text>
                </View>
                {isResolving ? (
                  <ActivityIndicator size="small" color={colors.brand.DEFAULT} />
                ) : isSelected ? (
                  <Ionicons name="checkmark-circle" size={20} color={colors.accent.DEFAULT} />
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <Pressable
        onPress={onAddNew}
        className="flex-row items-center justify-center rounded-2xl py-4 mt-2 border-2 border-dashed border-divider"
      >
        <Ionicons name="add" size={18} color={colors.accent.DEFAULT} />
        <Text className="text-accent font-semibold ml-1.5">Add new address</Text>
      </Pressable>
    </BottomSheetWrapper>
  );
};

export default AddressPickerBottomSheet;
