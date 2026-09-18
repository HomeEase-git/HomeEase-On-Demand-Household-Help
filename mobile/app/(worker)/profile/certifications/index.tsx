import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import CertificationCard from "../../../../components/cards/CertificationCard";
import StatusBadge from "../../../../components/ui/StatusBadge";
import type { StatusType } from "../../../../components/ui/StatusBadge";
import EmptyState from "../../../../components/feedback/EmptyState";
import { colors, cardShadow } from "../../../../constants";
import * as api from "../../../../services/api";
import type { Certification, KycDocumentRecord } from "../../../../services/api";
import { labelForKycDocumentType } from "../../../../utils/kycDocumentTypeMap";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

const DOC_STATUS_LABEL: Record<KycDocumentRecord["status"], StatusType> = {
  PENDING: "Pending",
  APPROVED: "Verified",
  REJECTED: "Declined",
};

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

export default function MyDocumentsScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const [certs, setCerts] = useState<Certification[]>([]);
  const [documents, setDocuments] = useState<KycDocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [certList, docList] = await Promise.all([api.getMyCertifications(), api.getKycDocuments()]);
        setCerts(certList);
        setDocuments(docList);
      } catch (error) {
        console.error("Load documents error:", error);
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

  const handleToggleVisibility = async (id: string, next: boolean) => {
    // Optimistic — flip immediately, roll back if the request fails.
    setCerts((prev) => prev.map((c) => (c.id === id ? { ...c, visibleToClients: next } : c)));
    try {
      await api.updateCertificationVisibility(id, next);
    } catch (error) {
      console.error("Update certification visibility error:", error);
      setCerts((prev) => prev.map((c) => (c.id === id ? { ...c, visibleToClients: !next } : c)));
      alertModal.error("Error", "Unable to update visibility right now.");
    }
  };

  const handleViewDocument = (doc: KycDocumentRecord) => {
    Linking.openURL(doc.fileUrl).catch(() => {
      alertModal.error("Error", "Unable to open this document right now.");
    });
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="My Documents" showBack />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.accent.DEFAULT} />
          <Text className="text-text-secondary mt-3">Loading documents...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="My Documents" showBack />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text className="text-text-primary font-bold text-base mb-1">Certifications</Text>
        <Text className="text-text-secondary text-xs mb-3">
          Professional credentials you choose to show on your public profile once verified.
        </Text>
        {certs.length === 0 ? (
          <EmptyState
            icon="ribbon-outline"
            title="No certifications yet"
            subtitle="Add your professional certifications to build client trust."
            actionLabel="Add Certification"
            onAction={() => router.push("/(worker)/profile/certifications/upload")}
          />
        ) : (
          certs.map((item) => (
            <CertificationCard
              key={item.id}
              cert={item}
              onPress={() => router.push(`/(worker)/profile/certifications/${item.id}`)}
              onEdit={() =>
                router.push({
                  pathname: "/(worker)/profile/certifications/upload",
                  params: { certId: item.id },
                })
              }
              onDelete={() => handleDelete(item.id)}
              onToggleVisibility={(next) => handleToggleVisibility(item.id, next)}
            />
          ))
        )}
        <Pressable
          className="flex-row items-center justify-center bg-accent/10 rounded-2xl py-3 mt-1 mb-8"
          onPress={() => router.push("/(worker)/profile/certifications/upload")}
        >
          <Ionicons name="add" size={18} color={colors.accent.DEFAULT} />
          <Text className="text-accent font-semibold ml-1">Add Certification</Text>
        </Pressable>

        <Text className="text-text-primary font-bold text-base mb-1">Verification Documents</Text>
        <Text className="text-text-secondary text-xs mb-3">
          Everything you have submitted for identity verification (ID, clearances, resume, etc.) — private
          to you, never shown to clients.
        </Text>
        {documents.length === 0 ? (
          <EmptyState
            icon="folder-open-outline"
            title="No documents yet"
            subtitle="Documents you submit for verification will show up here."
          />
        ) : (
          documents.map((doc) => (
            <Pressable
              key={doc.id}
              className="bg-card rounded-2xl p-4 mb-3"
              style={cardShadow}
              onPress={() => handleViewDocument(doc)}
            >
              <View className="flex-row justify-between items-start">
                <Text className="text-text-primary font-bold flex-1">
                  {labelForKycDocumentType(doc.documentType)}
                </Text>
                <StatusBadge status={DOC_STATUS_LABEL[doc.status]} />
              </View>
              <Text className="text-text-secondary text-sm mt-1">
                Submitted {formatDate(doc.createdAt)}
                {doc.expiresAt ? ` · Expires ${formatDate(doc.expiresAt)}` : ""}
              </Text>
              {doc.status === "REJECTED" && doc.rejectionReason ? (
                <Text className="text-error text-xs mt-1">{doc.rejectionReason}</Text>
              ) : null}
              <View className="flex-row items-center mt-2">
                <Ionicons name="eye-outline" size={16} color={colors.accent.DEFAULT} />
                <Text className="text-accent text-xs font-semibold ml-1">View document</Text>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
