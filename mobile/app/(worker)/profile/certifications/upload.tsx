import React, { useState, useRef } from "react";
import { View, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import InputField from "../../../../components/ui/InputField";
import UploadCard from "../../../../components/ui/UploadCard";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import ImageSourcePickerBottomSheet from "../../../../components/bottom-sheets/ImageSourcePickerBottomSheet";
import type { BottomSheetHandle } from "../../../../components/bottom-sheets/BottomSheetWrapper";

export default function UploadCertificationScreen() {
  const router = useRouter();
  const sheetRef = useRef<BottomSheetHandle | null>(null);
  const [name, setName] = useState("");
  const [issuer, setIssuer] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [documentUri, setDocumentUri] = useState<string | null>(null);

  const handleSelect = (uri: string) => {
    setDocumentUri(uri);
  };

  const handleSave = () => {
    if (!name.trim() || !issuer.trim()) {
      require("react-native").Alert.alert(
        "Error",
        "Please fill in the certificate name and issuing organization.",
      );
      return;
    }
    if (!documentUri) {
      require("react-native").Alert.alert(
        "Error",
        "Please upload a document photo.",
      );
      return;
    }
    require("react-native").Alert.alert(
      "Success",
      "Certification uploaded successfully.",
    );
    router.back();
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Upload Certification" showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <InputField
          label="Certificate Name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Plumbing License"
        />
        <InputField
          label="Issuing Organization"
          value={issuer}
          onChangeText={setIssuer}
          placeholder="e.g. PRC, TESDA"
        />
        <InputField
          label="Issue Date"
          value={issueDate}
          onChangeText={setIssueDate}
          placeholder="YYYY-MM-DD"
        />
        <InputField
          label="Expiry Date"
          value={expiryDate}
          onChangeText={setExpiryDate}
          placeholder="YYYY-MM-DD (leave blank if no expiry)"
        />
        <UploadCard
          label="Tap to upload document photo"
          onPress={() => sheetRef.current?.expand()}
          preview={documentUri ? "Document uploaded ✓" : null}
        />
        <View className="mt-4">
          <PrimaryButton
            label="Save Certification"
            fullWidth
            onPress={handleSave}
          />
        </View>
      </ScrollView>
      <ImageSourcePickerBottomSheet
        innerRef={sheetRef}
        onSelect={handleSelect}
      />
    </SafeAreaView>
  );
}
