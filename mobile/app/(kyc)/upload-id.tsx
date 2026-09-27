import React, { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import ScreenHeader from "../../components/ui/ScreenHeader";
import StepperHorizontal from "../../components/steppers/StepperHorizontal";
import UploadCard from "../../components/ui/UploadCard";
import PrimaryButton from "../../components/ui/PrimaryButton";
import InputField from "../../components/ui/InputField";
import { useAuthStore } from "../../store/authStore";
import {
  getMyWorkerProfileDetails,
  submitKycDocument,
  updateWorkerProfileDetails,
  uploadKycFile,
} from "../../services/api";
import { validateWorkerBirthDate } from "../../utils/validators";
import { compressImage } from "../../utils/imageCompressor";
import {
  documentRequirements,
  isDocumentTypeAllowed,
  type KycDocumentKey,
} from "../../utils/kycDocumentConfig";
import { useAlertModal } from "../../contexts/AlertModalContext";

// This screen only ever collects the government ID (front + back).
// Selfie, clearances, resume, and certifications each have their own
// screen further down the flow.
const ID_KEYS: KycDocumentKey[] = ["governmentIdFront", "governmentIdBack"];

type UploadedDocument = {
  uri: string | null;
  mimeType: string | null;
  name: string | null;
};

const initialDocuments: Partial<Record<KycDocumentKey, UploadedDocument>> = {
  governmentIdFront: { uri: null, mimeType: null, name: null },
  governmentIdBack: { uri: null, mimeType: null, name: null },
};

// Given at sign-up; shown here again so the worker can check it matches
// the ID (the admin compares the two at approval).
function birthDateError(value: string): string | null {
  return validateWorkerBirthDate(value).error ?? null;
}

const emptyDocument: UploadedDocument = {
  uri: null,
  mimeType: null,
  name: null,
};

export default function UploadIdScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const user = useAuthStore((s) => s.user);
  const isWorker = user?.role === "worker";
  const [documents, setDocuments] = useState(initialDocuments);
  const [uploadingKey, setUploadingKey] = useState<KycDocumentKey | null>(null);
  const [birthDate, setBirthDate] = useState("");
  const [savingBirthDate, setSavingBirthDate] = useState(false);
  const birthDateInvalid = isWorker ? birthDateError(birthDate.trim()) : null;

  // Pre-fill the date given at sign-up.
  useEffect(() => {
    if (!isWorker) return;
    let active = true;
    getMyWorkerProfileDetails()
      .then((profile) => {
        if (active && profile.birthDate) setBirthDate(profile.birthDate.slice(0, 10));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isWorker]);

  const handleContinue = async () => {
    if (!isWorker) {
      router.push("/(kyc)/selfie");
      return;
    }
    setSavingBirthDate(true);
    try {
      await updateWorkerProfileDetails({ birthDate: birthDate.trim() });
      router.push("/(kyc)/selfie");
    } catch (error: any) {
      alertModal.error(
        "Couldn't save your date of birth",
        error?.response?.data?.message || "Please try again.",
      );
    } finally {
      setSavingBirthDate(false);
    }
  };

  const missingRequired = useMemo(
    () => ID_KEYS.filter((key) => !documents[key]?.uri),
    [documents],
  );

  const stepperSteps = isWorker
    ? ["ID", "Selfie", "Documents", "Resume", "Contract"]
    : ["ID", "Selfie", "Contract"];

  const applyAsset = async (
    key: KycDocumentKey,
    uri: string,
    mimeType: string,
    name: string,
  ) => {
    if (!isDocumentTypeAllowed(key, mimeType)) {
      alertModal.error(
        "Invalid file type",
        "Government ID images must be JPG, JPEG, or PNG.",
      );
      return;
    }

    try {
      // Shrink + re-encode as JPEG before upload: smaller payloads, and it
      // converts iOS HEIC (which the backend rejects). Fall back to the
      // original if compression fails.
      let uploadUri = uri;
      let uploadMime = mimeType;
      try {
        const compressed = await compressImage(uri);
        uploadUri = compressed.uri;
        uploadMime = "image/jpeg";
      } catch (err) {
        console.error("KYC ID compression failed, using original", err);
      }

      const { url } = await uploadKycFile(key, uploadUri, uploadMime);
      await submitKycDocument(key, url);
      setDocuments((prev) => ({
        ...prev,
        [key]: { uri, mimeType, name },
      }));
      alertModal.success("Success", "Government ID uploaded successfully.");
    } catch (error: any) {
      console.error("KYC document submit error", error);
      alertModal.error(
        "Upload failed",
        error?.message ||
          "We could not submit your ID document. Please try again.",
      );
    }
  };

  const captureFromCamera = async (key: KycDocumentKey) => {
    setUploadingKey(key);
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        alertModal.warning(
          "Camera permission required",
          "Please allow camera access to take a photo of your ID.",
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        quality: 1,
      });

      if (result.canceled || !result.assets[0]?.uri) {
        return;
      }

      const asset = result.assets[0];
      await applyAsset(
        key,
        asset.uri,
        asset.mimeType || "image/jpeg",
        asset.fileName || `${key} photo`,
      );
    } catch (error) {
      console.error("KYC ID camera error", error);
      alertModal.error(
        "Upload failed",
        "We could not capture that photo. Please try again.",
      );
    } finally {
      setUploadingKey(null);
    }
  };

  const pickFromGallery = async (key: KycDocumentKey) => {
    setUploadingKey(key);
    try {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        alertModal.warning(
          "Photo access required",
          "Please allow photo access to upload your ID.",
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 1,
      });

      if (result.canceled || !result.assets[0]?.uri) {
        return;
      }

      const asset = result.assets[0];
      await applyAsset(
        key,
        asset.uri,
        asset.mimeType || "image/jpeg",
        asset.fileName || `${key} image`,
      );
    } catch (error) {
      console.error("KYC ID gallery error", error);
      alertModal.error(
        "Upload failed",
        "We could not process that file. Please try again.",
      );
    } finally {
      setUploadingKey(null);
    }
  };

  const pickFromFiles = async (key: KycDocumentKey) => {
    setUploadingKey(key);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["image/*"],
        copyToCacheDirectory: true,
      });

      if (result.canceled) {
        return;
      }

      const document = result.assets[0];
      if (!document?.uri) {
        return;
      }

      await applyAsset(
        key,
        document.uri,
        document.mimeType || "image/jpeg",
        document.name || `${key} document`,
      );
    } catch (error) {
      console.error("KYC ID file picker error", error);
      alertModal.error(
        "Upload failed",
        "We could not process that file. Please try again.",
      );
    } finally {
      setUploadingKey(null);
    }
  };

  const handleUpload = (key: KycDocumentKey) => {
    alertModal.info(
      documentRequirements[key].label,
      "Choose how you'd like to add this document.",
      [
        { text: "Camera", onPress: () => captureFromCamera(key) },
        { text: "Gallery", onPress: () => pickFromGallery(key) },
        { text: "Files", onPress: () => pickFromFiles(key) },
        { text: "Cancel", style: "cancel" },
      ],
    );
  };

  const renderUploadCard = (key: KycDocumentKey) => {
    const requirement = documentRequirements[key];
    const uploaded = documents[key] ?? emptyDocument;
    const preview = uploaded.uri
      ? uploaded.name || requirement.label
      : undefined;

    return (
      <View key={key} className="mb-3">
        <UploadCard
          label={requirement.label}
          subtitle={`${requirement.description} Accepted: ${requirement.accepts.join(", ")}`}
          required={requirement.required}
          preview={preview}
          onPress={() => handleUpload(key)}
          disabled={uploadingKey === key}
        />
      </View>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Upload Government ID" showBack />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }}
      >
        <StepperHorizontal steps={stepperSteps} currentStep={0} />
        <Text className="text-text-secondary text-sm mb-4">
          Upload a clear photo of the front and back of a valid
          government-issued ID.
        </Text>

        <View className="mb-4">
          {renderUploadCard("governmentIdFront")}
          {renderUploadCard("governmentIdBack")}
        </View>

        {isWorker && (
          <InputField
            label="Date of birth (as shown on your ID)"
            value={birthDate}
            onChangeText={setBirthDate}
            placeholder="YYYY-MM-DD"
            keyboardType="numbers-and-punctuation"
            error={birthDate.length >= 10 ? birthDateInvalid : null}
          />
        )}

        <View className="mt-4">
          <PrimaryButton
            label="Continue"
            fullWidth
            disabled={
              missingRequired.length > 0 ||
              uploadingKey !== null ||
              birthDateInvalid !== null ||
              savingBirthDate
            }
            loading={uploadingKey !== null || savingBirthDate}
            onPress={handleContinue}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
