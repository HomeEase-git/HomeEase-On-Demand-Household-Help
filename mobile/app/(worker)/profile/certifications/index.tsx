import React, { useEffect, useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import CertificationCard from "../../../../components/cards/CertificationCard";
import EmptyState from "../../../../components/feedback/EmptyState";
import { colors, cardShadow } from "../../../../constants";
import * as api from "../../../../services/api";
import type { Certification } from "../../../../services/api";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

export default function CertificationsScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const [certs, setCerts] = useState<Certification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const stored = await api.getMyCertifications();
        setCerts(stored);
      } catch (error) {
        console.error("Load certifications error:", error);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleDelete = async (id: string) => {
    alertModal.confirm(
      "Delete certification?",
      "This will remove the certification from your profile.",
      {
        confirmText: "Delete",
        destructive: true,
        onConfirm: async () => {
          try {
            await api.deleteCertification(id);
            setCerts((prev) => prev.filter((c) => c.id !== id));
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
      <ScreenHeader title="My Certifications" showBack />
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.accent.DEFAULT} />
          <Text className="text-text-secondary mt-3">Loading certifications...</Text>
        </View>
      ) : certs.length === 0 ? (
        <EmptyState
          icon="ribbon-outline"
          title="No certifications yet"
          subtitle="Add your professional certifications to build client trust."
          actionLabel="Add Certification"
          onAction={() =>
            router.push("/(worker)/profile/certifications/upload")
          }
        />
      ) : (
        <FlatList
          data={certs}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
          renderItem={({ item }) => (
            <CertificationCard
              cert={item}
              onPress={() =>
                router.push(`/(worker)/profile/certifications/${item.id}`)
              }
              onEdit={() =>
                router.push({
                  pathname: "/(worker)/profile/certifications/upload",
                  params: { certId: item.id },
                })
              }
              onDelete={() => handleDelete(item.id)}
            />
          )}
        />
      )}
      <Pressable
        className="absolute bottom-6 right-6 w-14 h-14 bg-accent rounded-full items-center justify-center"
        style={cardShadow}
        onPress={() => router.push("/(worker)/profile/certifications/upload")}
      >
        <Ionicons name="add" size={28} color={colors.white} />
      </Pressable>
    </SafeAreaView>
  );
}
