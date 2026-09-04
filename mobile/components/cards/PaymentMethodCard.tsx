import React from "react";
import { View, Text, Pressable } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { colors, cardShadow } from "../../constants";
import { useAlertModal } from "../../contexts/AlertModalContext";
import type { PaymentMethod } from "../../types/api.types";

type Props = {
  method: PaymentMethod;
  onEdit: () => void;
  onDelete: () => void;
  onSetDefault?: () => void;
  isDefault?: boolean;
};

export const PaymentMethodCard: React.FC<Props> = ({
  method,
  onEdit,
  onDelete,
  onSetDefault,
  isDefault = method.isDefault,
}) => {
  const alertModal = useAlertModal();

  const handleDelete = () => {
    alertModal.confirm(
      "Delete Payment Method",
      `Remove ${method.label || getDisplayLabel()} from your saved methods?`,
      { confirmText: "Delete", destructive: true, onConfirm: onDelete },
    );
  };

  const getIcon = () => {
    switch (method.type) {
      case "gcash":
      case "maya":
        return "wallet-outline";
      case "cash":
        return "cash-outline";
      default:
        return "wallet-outline";
    }
  };

  const getDisplayLabel = () => {
    switch (method.type) {
      case "gcash":
        return `GCash +${method.lastFour}`;
      case "maya":
        return `Maya +${method.lastFour}`;
      case "cash":
        return "Cash";
      default:
        return method.label || "Payment Method";
    }
  };

  return (
    <View className="bg-card rounded-2xl p-4 mb-3" style={cardShadow}>
      <View className="flex-row items-start">
        <View className="w-12 h-12 bg-accent/20 rounded-lg items-center justify-center mr-3">
          <Ionicons name={getIcon()} size={24} color={colors.accent.DEFAULT} />
        </View>
        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <Text className="text-text-primary font-bold">{getDisplayLabel()}</Text>
            {isDefault && (
              <View className="bg-success/20 rounded-full px-2 py-0.5">
                <Text className="text-success text-xs font-semibold">
                  Default
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>
      <View className="flex-row gap-2 mt-3">
        {!isDefault && onSetDefault && (
          <Pressable
            className="flex-1 py-2 px-3 rounded-lg border border-accent"
            onPress={onSetDefault}
          >
            <Text className="text-accent text-center text-sm font-semibold">
              Set Default
            </Text>
          </Pressable>
        )}
        <Pressable onPress={onEdit} className="p-2">
          <Ionicons name="pencil-outline" size={20} color={colors.text.muted} />
        </Pressable>
        <Pressable onPress={handleDelete} className="p-2">
          <Ionicons name="trash-outline" size={20} color={colors.error} />
        </Pressable>
      </View>
    </View>
  );
};

export default PaymentMethodCard;
