import React, { useEffect, useState } from "react";
import { View, Text, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import StatusBadge from "../../../../components/ui/StatusBadge";
import type { StatusType } from "../../../../components/ui/StatusBadge";
import DangerButton from "../../../../components/ui/DangerButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import { colors, cardShadow } from "../../../../constants";
import * as api from "../../../../services/api";
import type { Certification } from "../../../../services/api";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

export default function CertificationDetailScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const { certId } = useLocalSearchParams<{ certId: string }>();
  const [cert, setCert] = useState<Certification | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!certId) return;
      setLoading(true);
      try {
        const detail = await api.getCertificationDetail(certId);
        if (active) setCert(detail);
      } catch (error) {
        console.error("Load certification error:", error);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [certId]);

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Certification Details" showBack />
        <View className="flex-1 items-center justify-center">
          <Text className="text-text-secondary">Loading certification...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!cert) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Certification Details" showBack />
        <View className="flex-1 items-center justify-center">
          <Text className="text-text-secondary">Not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const handleDelete = () => {
    alertModal.confirm(
      "Delete Certification",
      `Are you sure you want to remove "${cert.name}"? This cannot be undone.`,
      {
        confirmText: "Delete",
        destructive: true,
        onConfirm: async () => {
          try {
            await api.deleteCertification(cert.id);
            alertModal.success("Deleted", `"${cert.name}" has been removed.`, [
              { text: "OK", onPress: () => router.back() },
            ]);
          } catch (error) {
            console.error("Delete certification error:", error);
            alertModal.error("Error", "Unable to delete certification right now.");
          }
        },
      },
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Certification Details" showBack />
      <View className="px-4 py-6">
        <View className="w-full h-48 bg-card-dark rounded-2xl items-center justify-center mb-4 overflow-hidden" style={cardShadow}>
          {cert.documentUrl ? (
            <Image
              source={{ uri: cert.documentUrl }}
              className="w-full h-full"
              resizeMode="cover"
            />
          ) : (
            <>
              <Ionicons
                name="document-text"
                size={60}
                color={colors.brand.DEFAULT}
              />
              <Text className="text-text-secondary mt-2">No document available</Text>
            </>
          )}
        </View>

        <View className="bg-card rounded-2xl p-4 mb-4" style={cardShadow}>
          <Text className="text-text-primary font-bold text-lg">{cert.name}</Text>
          <Text className="text-text-secondary text-sm mt-1">
            {cert.issuer}
          </Text>
          <Text className="text-text-muted text-xs mt-2">
            Issued: {cert.issueDate}
          </Text>
          {cert.expiryDate ? (
            <Text className="text-text-muted text-xs">
              Expires: {cert.expiryDate}
            </Text>
          ) : null}
          <View className="mt-3">
            <StatusBadge status={cert.status as StatusType} />
          </View>
          {cert.status === "Declined" && cert.rejectionReason ? (
            <Text className="text-error text-xs mt-2">
              Reason: {cert.rejectionReason}
            </Text>
          ) : null}
        </View>

        <View className="gap-3">
          <OutlinedButton
            label="Upload New Certification"
            onPress={() =>
              router.push("/(worker)/profile/certifications/upload")
            }
          />
          <DangerButton
            label="Delete Certification"
            fullWidth
            onPress={handleDelete}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}
