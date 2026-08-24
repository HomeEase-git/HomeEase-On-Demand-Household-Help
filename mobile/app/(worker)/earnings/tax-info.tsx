import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, FlatList, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import InputField from "../../../components/ui/InputField";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import { Skeleton } from "../../../components/ui/Skeleton";
import { cardShadow } from "../../../constants";
import * as api from "../../../services/api";
import { useAlertModal } from "../../../contexts/AlertModalContext";

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [info, certs] = await Promise.all([api.getTaxInfo(), api.getMyTaxCertificates()]);
        if (!active) return;
        setTaxInfo(info);
        setCertificates(certs);
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
