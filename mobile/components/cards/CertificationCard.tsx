import React from "react";
import { View, Text, Pressable } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import StatusBadge from "../ui/StatusBadge";
import type { StatusType } from "../ui/StatusBadge";
import { colors, cardShadow } from "../../constants";
import { useAlertModal } from "../../contexts/AlertModalContext";

type Cert = {
  id: string;
  name: string;
  issuer: string;
  issueDate: string;
  expiryDate: string | null;
  status: string;
};

type Props = {
  cert: Cert;
  onPress: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

export const CertificationCard: React.FC<Props> = ({
  cert,
  onPress,
  onEdit,
  onDelete,
}) => {
  const alertModal = useAlertModal();

  const handleDelete = () => {
    alertModal.confirm(
      "Delete Certification",
      `Remove "${cert.name}" from your certifications?`,
      { confirmText: "Delete", destructive: true, onConfirm: onDelete },
    );
  };

  return (
    <Pressable
      className="bg-card rounded-2xl p-4 mb-3"
      style={cardShadow}
      onPress={onPress}
    >
      <View className="flex-row justify-between items-start">
        <Text className="text-text-primary font-bold flex-1">{cert.name}</Text>
        <StatusBadge status={cert.status as StatusType} />
      </View>
      <Text className="text-text-secondary text-sm mt-1">{cert.issuer}</Text>
      <Text className="text-text-muted text-xs mt-1">
        {cert.issueDate} – {cert.expiryDate || "No expiry"}
      </Text>
      <View className="flex-row mt-2">
        <Pressable onPress={onEdit} className="p-2">
          <Ionicons name="pencil-outline" size={18} color={colors.text.muted} />
        </Pressable>
        <Pressable onPress={handleDelete} className="p-2">
          <Ionicons name="trash-outline" size={18} color={colors.error} />
        </Pressable>
      </View>
    </Pressable>
  );
};

export default CertificationCard;
