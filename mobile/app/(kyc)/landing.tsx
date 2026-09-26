import React, { useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../components/icons/AppIcon";
import { useRouter } from "expo-router";
import ScreenHeader from "../../components/ui/ScreenHeader";
import PrimaryButton from "../../components/ui/PrimaryButton";
import { colors } from "../../constants";
import { KycVerifyIllustration } from "../../components/illustrations/Illustrations";
import { useToastContext } from "../../contexts/ToastContext";
import { acceptContract } from "../../services/api";

// Short-form privacy notice shown at the point the most sensitive data is
// collected (Data Privacy Act §16(b)): what, why, who sees it, how long.
// Keep in sync with the Privacy Policy's KYC section.
const KYC_NOTICE = [
  {
    title: "What we collect",
    body: "Your government ID (front and back), a selfie, an NBI clearance and your resume. Optionally, a barangay or police clearance, cedula and certifications.",
  },
  {
    title: "Why",
    body: "To confirm you are who you say you are and are eligible to work on HomeEase, before clients can book you.",
  },
  {
    title: "Who sees it",
    body: "HomeEase admins who review your application. An automated AI service (Anthropic, USA) checks your ID, selfie and clearances first to help the reviewer; a person always makes the final decision. Clients see the skills and experience from your resume and only the certifications you choose to show.",
  },
  {
    title: "How long we keep it",
    body: "While your account is active. If you delete your account, your ID, selfie and document files are erased.",
  },
];

export default function KycLandingScreen() {
  const router = useRouter();
  const toast = useToastContext();
  const [consented, setConsented] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleStart = async () => {
    if (!consented || submitting) return;
    setSubmitting(true);
    try {
      await acceptContract("KYC_CONSENT");
      router.push("/(kyc)/upload-id");
    } catch {
      toast.error("Couldn't save your consent. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Identity Verification" showBack />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }}
      >
        <View className="items-center my-6">
          <KycVerifyIllustration size={160} />
        </View>
        <Text className="text-text-primary text-xl font-bold text-center">
          Verify Your Identity
        </Text>
        <View className="bg-card rounded-xl p-4 mt-4">
          <Text className="text-text-secondary text-sm">
            We need to verify your identity to keep HomeEase safe.
          </Text>
        </View>
        <View className="mt-6">
          {[
            "Valid government-issued ID (front and back)",
            "A clear selfie photo",
            "NBI clearance",
            "Your resume (PDF)",
          ].map((item, i) => (
            <View key={i} className="flex-row items-center mb-3">
              <Ionicons
                name="checkmark-circle"
                size={20}
                color={colors.success}
              />
              <Text className="text-text-secondary ml-2">{item}</Text>
            </View>
          ))}
        </View>

        <View className="bg-card rounded-xl p-4 mt-4">
          <Text className="text-text-primary font-bold text-base mb-3">
            How we use your documents
          </Text>
          {KYC_NOTICE.map((item) => (
            <View key={item.title} className="mb-3">
              <Text className="text-text-primary text-sm font-semibold">
                {item.title}
              </Text>
              <Text className="text-text-secondary text-sm">{item.body}</Text>
            </View>
          ))}
          <Text
            className="text-accent text-sm underline"
            onPress={() => router.push("/(auth)/privacy-policy")}
          >
            Read the full Privacy Policy
          </Text>
        </View>

        <Pressable
          className="flex-row items-center mt-6"
          onPress={() => setConsented(!consented)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: consented }}
        >
          <View
            className={`w-5 h-5 rounded border-2 mr-2 items-center justify-center ${
              consented ? "bg-accent border-accent" : "border-divider"
            }`}
          >
            {consented && (
              <Text className="text-text-primary text-xs font-bold">✓</Text>
            )}
          </View>
          <Text className="text-text-secondary text-sm flex-1">
            I consent to HomeEase collecting and reviewing my ID, selfie and
            documents as described above
          </Text>
        </Pressable>

        <View className="mt-8">
          <PrimaryButton
            label="Start Verification"
            fullWidth
            disabled={!consented || submitting}
            loading={submitting}
            onPress={handleStart}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
