import React from "react";
import { View, Text, Pressable } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { colors, cardShadow } from "../../constants";
import { useAlertModal } from "../../contexts/AlertModalContext";

type Address = {
  id: string;
  label: string;
  address: string;
  isDefault?: boolean;
};

type Props = {
  address: Address;
  onEdit: () => void;
  onDelete: () => void;
  onSetDefault?: () => void;
  isDefault?: boolean;
};

export const AddressCard: React.FC<Props> = ({
  address,
  onEdit,
  onDelete,
  onSetDefault,
  isDefault = address.isDefault,
}) => {
  const alertModal = useAlertModal();

  const handleDelete = () => {
    alertModal.confirm(
      "Delete Address",
      `Remove "${address.label}" from your saved addresses?`,
      { confirmText: "Delete", destructive: true, onConfirm: onDelete },
    );
  };

  return (
    <View className="bg-card rounded-2xl p-4 mb-3" style={cardShadow}>
      <View className="flex-row items-start">
        <Ionicons name="location-outline" size={24} color={colors.text.muted} />
        <View className="flex-1 ml-3">
          <View className="flex-row items-center gap-2">
            <Text className="text-text-primary font-bold">{address.label}</Text>
            {isDefault && (
              <View className="bg-accent rounded-full px-2 py-0.5">
                <Text className="text-white text-xs">Default</Text>
              </View>
            )}
          </View>
          <Text className="text-text-secondary text-sm mt-1">{address.address}</Text>
        </View>
        <Pressable onPress={onEdit} className="p-2">
          <Ionicons name="pencil-outline" size={20} color={colors.text.muted} />
        </Pressable>
        <Pressable onPress={handleDelete} className="p-2">
          <Ionicons name="trash-outline" size={20} color={colors.error} />
        </Pressable>
      </View>
      {!isDefault && onSetDefault && (
        <Pressable
          className="mt-3 py-2 px-3 rounded-lg border border-accent self-start"
          onPress={onSetDefault}
        >
          <Text className="text-accent text-center text-sm font-semibold">
            Set Default
          </Text>
        </Pressable>
      )}
    </View>
  );
};

export default AddressCard;
