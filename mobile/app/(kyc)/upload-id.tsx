import React, { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../components/ui/ScreenHeader";
import StepperHorizontal from "../../components/steppers/StepperHorizontal";
import { KYC_STEPS } from "../../constants";
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
import { useMediaPicker, type PickedMedia } from "../../hooks/useMediaPicker";
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
  const { pick } = useMediaPicker();
  // The picked photo while it uploads, so the card can show it straight away.
  const [pending, setPending] = useState<{ key: KycDocumentKey; uri: string } | null>(null);
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

  const stepperSteps = isWorker ? KYC_STEPS.worker : KYC_STEPS.client;

  const applyAsset = async (key: KycDocumentKey, media: PickedMedia) => {
    if (!isDocumentTypeAllowed(key, media.originalMimeType)) {
      alertModal.error(
        "Invalid file type",
        "Government ID images must be JPG, JPEG, or PNG.",
      );
      return;
    }

    setPending({ key, uri: media.uri });
    try {
      const { url } = await uploadKycFile(key, media.uri, media.mimeType);
      await submitKycDocument(key, url);
      setDocuments((prev) => ({
        ...prev,
        [key]: { uri: media.uri, mimeType: media.mimeType, name: media.name },
      }));
    } catch (error: any) {
      console.error("KYC document submit error", error);
      alertModal.error(
        "Upload failed",
        error?.message ||
          "We could not submit your ID document. Please try again.",
      );
    } finally {
      setPending(null);
    }
  };

  const handleUpload = (key: KycDocumentKey) =>
    pick({
      title: documentRequirements[key].label,
      message: "Choose how you'd like to add this document.",
      sources: ["camera", "gallery", "files"],
      fileTypes: ["image/*"],
      onPick: (media) => applyAsset(key, media),
    });

  const renderUploadCard = (key: KycDocumentKey) => {
    const requirement = documentRequirements[key];
    const uploaded = documents[key] ?? emptyDocument;
    const isPending = pending?.key === key;

    return (
      <View key={key} className="mb-3">
        <UploadCard
          label={requirement.label}
          subtitle={`${requirement.description} Accepted: ${requirement.accepts.join(", ")}`}
          required={requirement.required}
          imageUri={isPending ? pending.uri : uploaded.uri}
          uploading={isPending}
          onPress={() => handleUpload(key)}
          disabled={pending !== null}
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
              pending !== null ||
              birthDateInvalid !== null ||
              savingBirthDate
            }
            loading={pending !== null || savingBirthDate}
            onPress={handleContinue}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
