import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { KeyboardAwareScrollView } from "../../../../components/ui/KeyboardAwareScrollView";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import InputField from "../../../../components/ui/InputField";
import UploadCard from "../../../../components/ui/UploadCard";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import ImageSourcePickerBottomSheet from "../../../../components/bottom-sheets/ImageSourcePickerBottomSheet";
import type { BottomSheetHandle } from "../../../../components/bottom-sheets/BottomSheetWrapper";
import { colors } from "../../../../constants";
import * as api from "../../../../services/api";
import type { TaskCatalogEntry } from "../../../../services/api";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

// Matches the backend's MAX_REQUEST_DOCUMENTS (workerController.runCategoryGate).
const MAX_DOCUMENTS = 5;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type DocDraft = { key: string; title: string; issuer: string; issueDate: string; expiryDate: string; uri: string | null };

let seq = 0;
const emptyDoc = (): DocDraft => ({ key: `doc-${++seq}`, title: "", issuer: "", issueDate: "", expiryDate: "", uri: null });

// Auto-inserts dashes as the user types digits (YYYY-MM-DD).
function maskDateInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

/**
 * Request to offer a new service: pick it, attach the certifications or
 * documents that prove the skill, submit for admin review. Once approved,
 * the worker picks the service's tasks on the Skills & Services screen.
 */
export default function RequestServiceScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const params = useLocalSearchParams<{ serviceTypeId?: string }>();
  const sheetRef = useRef<BottomSheetHandle | null>(null);
  const pickingFor = useRef<string | null>(null);

  const [catalog, setCatalog] = useState<TaskCatalogEntry[] | null>(null);
  const [serviceTypeId, setServiceTypeId] = useState<string | null>(params.serviceTypeId ?? null);
  const [docs, setDocs] = useState<DocDraft[]>([emptyDoc()]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api
      .getMyTaskCatalog()
      .then(setCatalog)
      .catch((error) => {
        console.error("Load services error:", error);
        setCatalog([]);
      });
  }, []);

  // Services the worker isn't registered for (or was declined for).
  const available = useMemo(
    () => (catalog ?? []).filter((c) => c.categoryStatus == null || c.categoryStatus === "REJECTED"),
    [catalog],
  );
  const hasAnyService = useMemo(
    () => (catalog ?? []).some((c) => c.categoryStatus === "VERIFIED" || c.categoryStatus === "PENDING_VERIFICATION"),
    [catalog],
  );
  const selected = available.find((c) => c.serviceType.id === serviceTypeId) ?? null;
  // A worker's very first service is approved straight away unless the
  // admin requires a certification for it (backend runCategoryGate).
  const needsDocuments = !!selected && (hasAnyService || !!selected.serviceType.requiresCertification);

  const updateDoc = (key: string, patch: Partial<DocDraft>) =>
    setDocs((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const validateDocs = (): string | null => {
    for (const [i, d] of docs.entries()) {
      const n = docs.length > 1 ? ` (document ${i + 1})` : "";
      if (!d.title.trim() || !d.issuer.trim()) return `Enter the document name and who issued it${n}.`;
      if (!DATE_PATTERN.test(d.issueDate.trim())) return `Enter a valid issue date, YYYY-MM-DD${n}.`;
      if (d.expiryDate.trim() && !DATE_PATTERN.test(d.expiryDate.trim())) return `Enter a valid expiry date, YYYY-MM-DD${n}.`;
      if (!d.uri) return `Add a photo of the document${n}.`;
    }
    return null;
  };

  const handleSubmit = async () => {
    if (!selected) {
      alertModal.error("Error", "Pick the service you want to offer.");
      return;
    }
    if (needsDocuments) {
      const problem = validateDocs();
      if (problem) {
        alertModal.error("Error", problem);
        return;
      }
    }

    setSubmitting(true);
    try {
      const certifications = needsDocuments
        ? await Promise.all(
            docs.map(async (d) => ({
              title: d.title.trim(),
              issuer: d.issuer.trim(),
              issueDate: d.issueDate.trim(),
              expiryDate: d.expiryDate.trim() || undefined,
              documentUrl: (await api.uploadCertificationFile(d.uri!)).url,
            })),
          )
        : undefined;
      const category = await api.addServiceCategory(selected.serviceType.id, { certifications });
      if (category?.status === "VERIFIED") {
        alertModal.success("Service added", "You can now pick the tasks you do for this service.");
      } else {
        alertModal.success("Request sent", "An admin will review your documents. We'll notify you once it's approved.");
      }
      router.back();
    } catch (error: any) {
      console.error("Request service error:", error);
      alertModal.error("Error", error?.message || "Failed to send your request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Request a New Service" showBack />
      <KeyboardAwareScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        {catalog == null ? (
          <View className="items-center py-10">
            <ActivityIndicator size="small" />
          </View>
        ) : available.length === 0 ? (
          <View className="bg-card rounded-2xl p-4">
            <Text className="text-text-secondary text-sm">
              You&apos;ve already registered for or requested every service available.
            </Text>
          </View>
        ) : (
          <>
            <Text className="text-text-primary font-bold mb-2">Which service?</Text>
            <View className="flex-row flex-wrap gap-2 mb-6">
              {available.map((c) => {
                const isSelected = serviceTypeId === c.serviceType.id;
                return (
                  <Pressable
                    key={c.serviceType.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => setServiceTypeId(c.serviceType.id)}
                    className={`rounded-xl px-3.5 py-2.5 border-2 ${
                      isSelected ? "bg-accent/10 border-accent" : "bg-card border-transparent"
                    }`}
                  >
                    <Text className={`text-sm font-medium ${isSelected ? "text-accent" : "text-text-secondary"}`}>
                      {c.serviceType.name}
                      {c.categoryStatus === "REJECTED" ? " (declined before)" : ""}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {selected && !needsDocuments && (
              <View className="bg-card rounded-2xl p-4 mb-6">
                <Text className="text-text-secondary text-sm">
                  This is your first service, so it&apos;s added right away. Later services need documents
                  reviewed by an admin.
                </Text>
              </View>
            )}

            {selected && needsDocuments && (
              <>
                <Text className="text-text-primary font-bold mb-1">Proof of your skills</Text>
                <Text className="text-text-muted text-sm mb-4">
                  Add certifications, licenses or other documents (e.g. TESDA NC II, a training certificate, a
                  previous employer&apos;s certificate). An admin reviews them before you can take{" "}
                  {selected.serviceType.name} jobs.
                </Text>

                {docs.map((d, index) => (
                  <View key={d.key} className="bg-card rounded-2xl p-4 mb-4">
                    <View className="flex-row items-center justify-between mb-2">
                      <Text className="text-text-secondary font-semibold text-sm">Document {index + 1}</Text>
                      {docs.length > 1 && (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Remove document ${index + 1}`}
                          onPress={() => setDocs((prev) => prev.filter((x) => x.key !== d.key))}
                          className="p-1"
                        >
                          <Ionicons name="trash-outline" size={18} color={colors.error} />
                        </Pressable>
                      )}
                    </View>
                    <InputField
                      label="Document name"
                      value={d.title}
                      onChangeText={(v) => updateDoc(d.key, { title: v })}
                      placeholder="e.g. TESDA NC II – Plumbing"
                    />
                    <InputField
                      label="Issued by"
                      value={d.issuer}
                      onChangeText={(v) => updateDoc(d.key, { issuer: v })}
                      placeholder="e.g. TESDA, PRC"
                    />
                    <InputField
                      label="Issue date"
                      value={d.issueDate}
                      onChangeText={(v) => updateDoc(d.key, { issueDate: maskDateInput(v) })}
                      placeholder="YYYY-MM-DD"
                      keyboardType="number-pad"
                    />
                    <InputField
                      label="Expiry date (optional)"
                      value={d.expiryDate}
                      onChangeText={(v) => updateDoc(d.key, { expiryDate: maskDateInput(v) })}
                      placeholder="YYYY-MM-DD"
                      keyboardType="number-pad"
                    />
                    <UploadCard
                      required
                      label="Tap to add a photo of the document"
                      onPress={() => {
                        pickingFor.current = d.key;
                        sheetRef.current?.expand();
                      }}
                      preview={d.uri ? "Photo added ✓ (tap to replace)" : null}
                    />
                  </View>
                ))}

                {docs.length < MAX_DOCUMENTS && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setDocs((prev) => [...prev, emptyDoc()])}
                    className="flex-row items-center mb-6"
                  >
                    <Ionicons name="add-circle-outline" size={18} color={colors.accent.DEFAULT} />
                    <Text className="text-accent text-sm font-semibold ml-1.5">Add another document</Text>
                  </Pressable>
                )}
              </>
            )}

            <PrimaryButton
              label={needsDocuments ? "Submit for Review" : "Add Service"}
              fullWidth
              onPress={handleSubmit}
              disabled={submitting || !selected}
              loading={submitting}
            />
          </>
        )}
      </KeyboardAwareScrollView>
      <ImageSourcePickerBottomSheet
        innerRef={sheetRef}
        onSelect={(uri) => {
          if (pickingFor.current) updateDoc(pickingFor.current, { uri });
        }}
      />
    </SafeAreaView>
  );
}
