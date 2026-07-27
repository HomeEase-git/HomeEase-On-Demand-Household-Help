import React from "react";
import { View, Text, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import StatusBadge from "../../../../components/ui/StatusBadge";
import DangerButton from "../../../../components/ui/DangerButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import { colors } from "../../../../constants";

const CERTS: Record<
  string,
  {
    name: string;
    issuer: string;
    issueDate: string;
    expiryDate: string;
    status: string;
  }
> = {
  cert1: {
    name: "Plumbing License",
    issuer: "PRC",
    issueDate: "2020-01-01",
    expiryDate: "2025-01-01",
    status: "Verified",
  },
  cert2: {
    name: "Safety Training",
    issuer: "TESDA",
    issueDate: "2021-06-01",
    expiryDate: "2024-06-01",
    status: "Verified",
  },
};

export default function CertificationDetailScreen() {
  const router = useRouter();
  const { certId } = useLocalSearchParams<{ certId: string }>();
  const cert = certId ? CERTS[certId] : null;

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
    Alert.alert(
      "Delete Certification",
      `Are you sure you want to remove "${cert.name}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            Alert.alert("Deleted", `"${cert.name}" has been removed.`, [
              { text: "OK", onPress: () => router.back() },
            ]);
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Certification Details" showBack />
      <View className="px-4 py-6">
        <View className="w-full h-48 bg-card-dark rounded-2xl items-center justify-center mb-4">
          <Ionicons
            name="document-text"
            size={60}
            color={colors.brand.DEFAULT}
          />
          <Text className="text-text-secondary mt-2">Document Preview</Text>
          <Text className="text-text-muted text-xs mt-1">
            Full document viewing available after backend integration
          </Text>
        </View>

        <View className="bg-card rounded-2xl p-4 mb-4">
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
            <StatusBadge status={cert.status as "Verified"} />
          </View>
        </View>

        <View className="gap-3">
          <OutlinedButton
            label="Edit Certification"
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
