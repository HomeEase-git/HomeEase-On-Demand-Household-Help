import React, { useEffect, useState } from "react";
import { View, Text, FlatList, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import CertificationCard from "../../../../components/cards/CertificationCard";
import EmptyState from "../../../../components/feedback/EmptyState";
import { colors } from "../../../../constants";
import { certificationStorage } from "../../../../utils/storage";

type Cert = {
  id: string;
  name: string;
  issuer: string;
  issueDate: string;
  expiryDate: string;
  status: string;
};

export default function CertificationsScreen() {
  const router = useRouter();
  const [certs, setCerts] = useState<Cert[]>([]);
  const [loading, setLoading] = useState(true);

  const loadCerts = async () => {
    setLoading(true);
    const stored = await certificationStorage.list();
    setCerts(stored);
    setLoading(false);
  };

  useEffect(() => {
    loadCerts();
  }, []);

  const handleDelete = async (id: string) => {
    Alert.alert(
      "Delete certification?",
      "This will remove the certification from your profile.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const ok = await certificationStorage.remove(id);
            if (ok) {
              setCerts((prev) => prev.filter((c) => c.id !== id));
            } else {
              Alert.alert("Error", "Unable to delete certification right now.");
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-primary-white">
      <ScreenHeader title="My Certifications" showBack />
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-text-secondary">Loading certifications...</Text>
        </View>
      ) : certs.length === 0 ? (
        <EmptyState
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
                router.push("/(worker)/profile/certifications/upload")
              }
              onDelete={() => handleDelete(item.id)}
            />
          )}
        />
      )}
      <Pressable
        className="absolute bottom-6 right-6 w-14 h-14 bg-accent rounded-full items-center justify-center"
        onPress={() => router.push("/(worker)/profile/certifications/upload")}
      >
        <Ionicons name="add" size={28} color={colors.white} />
      </Pressable>
    </SafeAreaView>
  );
}
