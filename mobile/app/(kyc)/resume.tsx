import React, { useEffect, useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import ScreenHeader from "../../components/ui/ScreenHeader";
import StepperHorizontal from "../../components/steppers/StepperHorizontal";
import PrimaryButton from "../../components/ui/PrimaryButton";
import OutlinedButton from "../../components/ui/OutlinedButton";
import UploadCard from "../../components/ui/UploadCard";
import { useAuthStore } from "../../store/authStore";
import { submitKycDocument, uploadKycFile } from "../../services/api";
import { useAlertModal } from "../../contexts/AlertModalContext";

// Worker-only screen — clients never reach this (selfie.tsx sends
// them straight to the contract), but guard against direct navigation.
export default function ResumeScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const user = useAuthStore((s) => s.user);
  const isWorker = user?.role === "worker";
  const [resumeFile, setResumeFile] = useState<{
    uri: string | null;
    name: string | null;
  }>({
    uri: null,
    name: null,
  });
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isWorker) {
      router.replace("/(kyc)/contract");
    }
  }, [isWorker, router]);

  if (!isWorker) {
    return null;
  }

  const handleUploadResume = async () => {
    if (uploading) {
      return;
    }

    setUploading(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf"],
        copyToCacheDirectory: true,
      });

      if (result.canceled) {
        return;
      }

      const document = result.assets?.[0];
      if (!document?.uri) {
        alertModal.error("Upload failed", "We could not access the selected file.");
        return;
      }

      try {
        setSubmitting(true);
        const { url } = await uploadKycFile("resume", document.uri, document.mimeType);
        await submitKycDocument("resume", url);
        setResumeFile({
          uri: document.uri,
          name: document.name || "resume.pdf",
        });
        alertModal.success("Success", "Resume uploaded successfully.");
      } catch (error) {
        console.error("KYC resume submit error", error);
        alertModal.error(
          "Upload failed",
          "We could not submit your resume. Please try again.",
        );
      } finally {
        setSubmitting(false);
      }
    } catch (error) {
      console.error("Resume upload error", error);
      alertModal.error(
        "Upload failed",
        "We could not upload your resume. Please try again.",
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Upload Resume" showBack />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }}
      >
        <StepperHorizontal
          steps={["ID", "Selfie", "Documents", "Resume", "Contract"]}
          currentStep={3}
        />
        <Text className="text-text-secondary text-sm mb-4">
          Resume upload is required for workers and must be a PDF file.
        </Text>

        <View className="bg-card rounded-xl p-4 mb-6">
          <Text className="text-primary font-semibold mb-2">
            Why we need your resume
          </Text>
          <Text className="text-text-secondary text-sm">
            Your resume helps clients understand your experience, skills, and
            professional background. It will be used for verification and
            profile completion.
          </Text>
        </View>

        <View className="mb-6">
          <UploadCard
            label="Upload Resume"
            subtitle="Select a PDF file from your device."
            required
            preview={
              resumeFile.uri ? resumeFile.name || "Resume uploaded" : undefined
            }
            onPress={handleUploadResume}
            disabled={uploading || submitting}
          />
        </View>

        <View className="gap-3 mt-2">
          <PrimaryButton
            label="Continue"
            fullWidth
            disabled={!resumeFile.uri || uploading || submitting}
            onPress={() => router.push("/(kyc)/contract")}
          />
          <OutlinedButton
            label="Skip for Now"
            onPress={() => router.push("/(kyc)/contract")}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
