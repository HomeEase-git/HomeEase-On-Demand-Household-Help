import React, { useEffect, useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../components/ui/ScreenHeader";
import StepperHorizontal from "../../components/steppers/StepperHorizontal";
import { KYC_STEPS } from "../../constants";
import PrimaryButton from "../../components/ui/PrimaryButton";
import UploadCard from "../../components/ui/UploadCard";
import InputField from "../../components/ui/InputField";
import { useAuthStore } from "../../store/authStore";
import {
  getMyWorkerProfileDetails,
  submitKycDocument,
  updateWorkerProfileDetails,
  uploadKycFile,
} from "../../services/api";
import { useAlertModal } from "../../contexts/AlertModalContext";
import { useMediaPicker } from "../../hooks/useMediaPicker";

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
  const { pick } = useMediaPicker();
  const [submitting, setSubmitting] = useState(false);
  // Years of experience decide which expertise tiers the worker can reach;
  // the admin checks it against the resume at approval.
  const [years, setYears] = useState("");
  const [savingYears, setSavingYears] = useState(false);
  const yearsNumber = /^\d{1,2}$/.test(years.trim()) ? Number(years.trim()) : NaN;
  const yearsValid = Number.isInteger(yearsNumber) && yearsNumber >= 0 && yearsNumber <= 60;

  useEffect(() => {
    if (!isWorker) {
      router.replace("/(kyc)/contract");
    }
  }, [isWorker, router]);

  useEffect(() => {
    if (!isWorker) return;
    let active = true;
    getMyWorkerProfileDetails()
      .then((profile) => {
        if (active && profile.yearsExperience != null) setYears(String(profile.yearsExperience));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isWorker]);

  if (!isWorker) {
    return null;
  }

  const handleUploadResume = () =>
    pick({
      title: "Upload Resume",
      sources: ["files"],
      fileTypes: ["application/pdf"],
      onPick: async (media) => {
        setSubmitting(true);
        try {
          const { url } = await uploadKycFile("resume", media.uri, media.mimeType);
          await submitKycDocument("resume", url);
          setResumeFile({ uri: media.uri, name: media.name || "resume.pdf" });
        } catch (error) {
          console.error("KYC resume submit error", error);
          alertModal.error(
            "Upload failed",
            "We could not submit your resume. Please try again.",
          );
        } finally {
          setSubmitting(false);
        }
      },
    });

  const handleContinue = async () => {
    setSavingYears(true);
    try {
      await updateWorkerProfileDetails({ yearsExperience: yearsNumber });
      router.push("/(kyc)/contract");
    } catch (error: any) {
      alertModal.error("Couldn't save your experience", error?.message || "Please try again.");
    } finally {
      setSavingYears(false);
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
          steps={KYC_STEPS.worker}
          currentStep={3}
        />
        <Text className="text-text-secondary text-sm mb-4">
          A resume is required and must be a PDF.
        </Text>

        <View className="bg-card rounded-xl p-4 mb-6">
          <Text className="text-text-primary font-semibold mb-2">
            Why we ask
          </Text>
          <Text className="text-text-secondary text-sm">
            HomeEase reviews it as part of your application, and the skills
            and experience in it are shown to clients on your profile.
          </Text>
        </View>

        <View className="mb-6">
          <UploadCard
            label="Upload Resume"
            subtitle="Select a PDF file from your device."
            hint="Tap to choose a PDF"
            required
            preview={
              resumeFile.uri ? resumeFile.name || "Resume uploaded" : undefined
            }
            uploading={submitting}
            onPress={handleUploadResume}
            disabled={submitting}
          />
        </View>

        <InputField
          label="Years of experience in your trade"
          value={years}
          onChangeText={setYears}
          placeholder="e.g. 5"
          keyboardType="number-pad"
          error={years.trim() && !yearsValid ? "Enter a whole number from 0 to 60" : null}
        />
        <Text className="text-text-muted text-xs -mt-2 mb-4">
          Higher expertise tiers need more years of experience. HomeEase checks this against your resume.
        </Text>

        <View className="gap-3 mt-2">
          <PrimaryButton
            label="Continue"
            fullWidth
            disabled={!resumeFile.uri || !yearsValid || submitting || savingYears}
            loading={savingYears}
            onPress={handleContinue}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
