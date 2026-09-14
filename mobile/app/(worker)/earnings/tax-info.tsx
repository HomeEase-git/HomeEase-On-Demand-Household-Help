import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, FlatList, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import InputField from "../../../components/ui/InputField";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import { colors, cardShadow } from "../../../constants";
import * as api from "../../../services/api";
import { compressImage } from "../../../utils/imageCompressor";
import { useAlertModal } from "../../../contexts/AlertModalContext";

const VAT_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

const VAT_STATUS_COLORS: Record<string, string> = {
  PENDING: colors.warning,
  APPROVED: colors.success,
  REJECTED: colors.error,
};

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

function formatPeso(amount: number) {
  return `₱${amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function TaxInfoScreen() {
  const alertModal = useAlertModal();
  const [tin, setTin] = useState("");
  const [taxInfo, setTaxInfo] = useState<api.TaxInfo | null>(null);
  const [certificates, setCertificates] = useState<api.TaxCertificate[]>([]);
  const [vatRegistration, setVatRegistration] = useState<api.VatRegistration | null>(null);
  const [vatSummaries, setVatSummaries] = useState<api.VatSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submittingVat, setSubmittingVat] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [info, certs, vat, vatSummary] = await Promise.all([
          api.getTaxInfo(),
          api.getMyTaxCertificates(),
          api.getMyVatRegistration(),
          api.getMyVatSummary(),
        ]);
        if (!active) return;
        setTaxInfo(info);
        setCertificates(certs);
        setVatRegistration(vat);
        setVatSummaries(vatSummary);
      } catch (error) {
        console.error("Load tax info error:", error);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  const handleSubmitVatDocument = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        alertModal.warning("File access required", "Please allow photo access to choose a document file.");
        return;
      }

      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/*"],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;

      const document = result.assets[0];
      if (!document?.uri) return;

      setSubmittingVat(true);
      let uploadUri = document.uri;
      let uploadMime = document.mimeType || "application/octet-stream";
      if (uploadMime.startsWith("image/")) {
        try {
          const compressed = await compressImage(document.uri);
          uploadUri = compressed.uri;
          uploadMime = "image/jpeg";
        } catch (err) {
          console.error("VAT document compression failed, using original", err);
        }
      }

      const { url } = await api.uploadVatDocument(uploadUri, uploadMime);
      const updated = await api.submitVatRegistration(url);
      setVatRegistration(updated);
      alertModal.success("Submitted", "Your VAT registration document was submitted for review.");
    } catch (error) {
      console.error("Submit VAT registration error:", error);
      alertModal.error("Error", "Failed to submit your document. Please try again.");
    } finally {
      setSubmittingVat(false);
    }
  };

  const handleSave = async () => {
    if (!tin.trim()) {
      alertModal.error("Error", "Please enter your TIN.");
      return;
    }
    setSaving(true);
    try {
      const updated = await api.updateTaxInfo(tin.trim());
      setTaxInfo(updated);
      setTin("");
      alertModal.success("Saved", "Your TIN has been saved.");
    } catch (error: any) {
      console.error("Save tax info error:", error);
      alertModal.error("Error", error?.message || "Failed to save your TIN. Please check the format and try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = (cert: api.TaxCertificate) => {
    if (cert.downloadUrl) {
      Linking.openURL(cert.downloadUrl);
    }
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Tax Information" showBack />
        <View className="flex-1 items-center justify-center">
          <Text className="text-text-secondary">Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Tax Information" showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Text className="text-text-primary font-bold mb-2">TIN on File</Text>
        <View className="bg-card rounded-2xl p-4 mb-4" style={cardShadow}>
          <Text className="text-text-primary">
            {taxInfo?.tinOnFile ? taxInfo.maskedTin : "No TIN saved yet"}
          </Text>
          <Text className="text-text-secondary text-xs mt-1">
            Required before we can generate your BIR Form 2307 withholding certificate. This is used only for
            tax-compliance purposes.
          </Text>
        </View>
        <InputField
          label={taxInfo?.tinOnFile ? "Update TIN" : "TIN"}
          value={tin}
          onChangeText={setTin}
          placeholder="e.g. 123-456-789"
          keyboardType="numeric"
        />
        <PrimaryButton
          label="Save TIN"
          fullWidth
          onPress={handleSave}
          disabled={saving}
          loading={saving}
        />

        <Text className="text-text-primary font-bold mt-8 mb-2">VAT Registration</Text>
        <View className="bg-card rounded-2xl p-4 mb-4" style={cardShadow}>
          <Text className="text-text-secondary text-xs mb-3">
            Only required if your gross annual earnings cross BIR&apos;s VAT threshold. Submit proof (e.g. your BIR
            Certificate of Registration) and an admin will review it — VAT only applies to your bookings once approved.
          </Text>
          {vatRegistration?.vatRegistered ? (
            <Text className="font-semibold" style={{ color: colors.success }}>
              ✓ VAT-registered — verified
            </Text>
          ) : vatRegistration?.vatVerificationStatus ? (
            <>
              <Text
                className="font-semibold mb-1"
                style={{ color: VAT_STATUS_COLORS[vatRegistration.vatVerificationStatus] }}
              >
                {VAT_STATUS_LABELS[vatRegistration.vatVerificationStatus]}
              </Text>
              {vatRegistration.vatVerificationStatus === "REJECTED" && vatRegistration.vatRejectionReason && (
                <Text className="text-text-secondary text-xs mb-3">Reason: {vatRegistration.vatRejectionReason}</Text>
              )}
            </>
          ) : (
            <Text className="text-text-muted text-sm mb-3">Not submitted</Text>
          )}
          {vatRegistration?.vatVerificationStatus !== "PENDING" && (
            <PrimaryButton
              label={vatRegistration?.vatVerificationStatus === "REJECTED" ? "Resubmit Document" : "Submit Document"}
              fullWidth
              onPress={handleSubmitVatDocument}
              disabled={submittingVat}
              loading={submittingVat}
            />
          )}
        </View>

        {vatRegistration?.vatRegistered && (
          <>
            <Text className="text-text-primary font-bold mt-8 mb-2">VAT You Collected</Text>
            <Text className="text-text-secondary text-xs mb-3">
              For your own 2550Q/2551Q filing — not remitted by the platform. Ask an admin to generate a period's
              summary if it's missing here.
            </Text>
            {vatSummaries.length === 0 ? (
              <Text className="text-text-secondary text-sm">No summaries generated yet.</Text>
            ) : (
              <FlatList
                data={vatSummaries}
                keyExtractor={(item) => item.id}
                scrollEnabled={false}
                renderItem={({ item }) => (
                  <View className="bg-card rounded-2xl p-3 mb-2" style={cardShadow}>
                    <Text className="text-text-primary font-semibold">
                      {formatDate(item.periodStart)} – {formatDate(item.periodEnd)}
                    </Text>
                    <Text className="text-text-secondary text-xs mt-1">
                      VAT collected: {formatPeso(item.totalVatCollected)}
                    </Text>
                  </View>
                )}
              />
            )}
          </>
        )}

        <Text className="text-text-primary font-bold mt-8 mb-2">Tax Documents</Text>
        {certificates.length === 0 ? (
          <Text className="text-text-secondary text-sm">
            No certificates issued yet — these appear here once generated for a completed reporting period.
          </Text>
        ) : (
          <FlatList
            data={certificates}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <View className="bg-card rounded-2xl p-3 mb-2" style={cardShadow}>
                <View className="flex-row items-center justify-between">
                  <View>
                    <Text className="text-text-primary font-semibold">
                      {formatDate(item.periodStart)} – {formatDate(item.periodEnd)}
                    </Text>
                    <Text className="text-text-secondary text-xs mt-1">
                      Tax withheld: {formatPeso(item.totalTaxWithheld)}
                    </Text>
                  </View>
                  <Text
                    className="text-accent font-semibold"
                    onPress={() => handleDownload(item)}
                  >
                    Download
                  </Text>
                </View>
              </View>
            )}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
