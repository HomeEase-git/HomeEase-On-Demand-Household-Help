import React, { useEffect, useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import StatusBadge from "../../../../components/ui/StatusBadge";
import type { StatusType } from "../../../../components/ui/StatusBadge";
import EmptyState from "../../../../components/feedback/EmptyState";
import { colors, cardShadow } from "../../../../constants";
import * as api from "../../../../services/api";
import type { KycDocumentRecord } from "../../../../services/api";
import { labelForKycDocumentType } from "../../../../utils/kycDocumentTypeMap";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

const STATUS_LABEL: Record<KycDocumentRecord["status"], StatusType> = {
  PENDING: "Pending",
  APPROVED: "Verified",
  REJECTED: "Declined",
};

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

export default function MyDocumentsScreen() {
  const alertModal = useAlertModal();
  const [documents, setDocuments] = useState<KycDocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const docs = await api.getKycDocuments();
        setDocuments(docs);
      } catch (error) {
        console.error("Load KYC documents error:", error);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleView = (doc: KycDocumentRecord) => {
    Linking.openURL(doc.fileUrl).catch(() => {
      alertModal.error("Error", "Unable to open this document right now.");
    });
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="My Documents" showBack />
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.accent.DEFAULT} />
          <Text className="text-text-secondary mt-3">Loading documents...</Text>
        </View>
      ) : documents.length === 0 ? (
        <EmptyState
          icon="folder-open-outline"
          title="No documents yet"
          subtitle="Documents you submit for verification (ID, clearances, resume, and more) will show up here."
        />
      ) : (
        <FlatList
          data={documents}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <Pressable
              className="bg-card rounded-2xl p-4 mb-3"
              style={cardShadow}
              onPress={() => handleView(item)}
            >
              <View className="flex-row justify-between items-start">
                <Text className="text-text-primary font-bold flex-1">
                  {labelForKycDocumentType(item.documentType)}
                </Text>
                <StatusBadge status={STATUS_LABEL[item.status]} />
              </View>
              <Text className="text-text-secondary text-sm mt-1">
                Submitted {formatDate(item.createdAt)}
                {item.expiresAt ? ` · Expires ${formatDate(item.expiresAt)}` : ""}
              </Text>
              {item.status === "REJECTED" && item.rejectionReason ? (
                <Text className="text-error text-xs mt-1">{item.rejectionReason}</Text>
              ) : null}
              <View className="flex-row items-center mt-2">
                <Ionicons name="eye-outline" size={16} color={colors.accent.DEFAULT} />
                <Text className="text-accent text-xs font-semibold ml-1">View document</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}
