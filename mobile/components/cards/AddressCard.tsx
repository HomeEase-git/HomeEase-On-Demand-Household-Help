import React from "react";
import { View, Text, Pressable, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, cardShadow } from "../../constants";

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
  isDefault?: boolean;
};

export const AddressCard: React.FC<Props> = ({
  address,
  onEdit,
  onDelete,
  isDefault = address.isDefault,
}) => {
  const handleDelete = () => {
    Alert.alert(
      "Delete Address",
      `Remove "${address.label}" from your saved addresses?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: onDelete },
      ],
    );
  };

  return (
    <View className="bg-card rounded-2xl p-4 mb-3 flex-row items-start" style={cardShadow}>
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
  );
};

export default AddressCard;
