import React from "react";
import { View, Text, Pressable } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { colors, cardShadow } from "../../constants";
import type { WorkerPackage } from "../../services/api";

type Props = {
  pkg: WorkerPackage;
  onEdit: () => void;
  onDelete: () => void;
};

export const PackageCard: React.FC<Props> = ({ pkg, onEdit, onDelete }) => {
  return (
    <View className="bg-card rounded-2xl p-4 mb-3 flex-row items-center" style={cardShadow}>
      <View className="flex-1">
        <Text className="text-text-primary font-bold">{pkg.name}</Text>
        {pkg.serviceType?.name && (
          <View className="bg-accent/20 rounded-full px-2 py-0.5 self-start mt-1">
            <Text className="text-accent text-xs">{pkg.serviceType.name}</Text>
          </View>
        )}
        {pkg.description ? (
          <Text className="text-text-secondary text-xs mt-1" numberOfLines={2}>
            {pkg.description}
          </Text>
        ) : null}
        <Text className="text-accent font-semibold mt-2">₱{pkg.price}</Text>
        {!pkg.isActive && (
          <Text className="text-text-muted text-xs mt-1">Inactive — hidden from clients</Text>
        )}
      </View>
      <Pressable onPress={onEdit} className="p-2">
        <Ionicons name="pencil-outline" size={20} color={colors.text.muted} />
      </Pressable>
      <Pressable onPress={onDelete} className="p-2">
        <Ionicons name="trash-outline" size={20} color={colors.error} />
      </Pressable>
    </View>
  );
};

export default PackageCard;
