import React, { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../../components/icons/AppIcon";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../components/ui/OutlinedButton";
import { parseMyResume, updateWorkerProfileDetails } from "../../../services/api";
import type { ParsedResume } from "../../../types/api.types";
import { colors, cardShadow } from "../../../constants";
import { useAlertModal } from "../../../contexts/AlertModalContext";

const LEVEL_COLOR: Record<string, { bg: string; text: string }> = {
  Expert: { bg: "bg-success/20", text: "text-success" },
  Advanced: { bg: "bg-accent/20", text: "text-accent" },
  Intermediate: { bg: "bg-warning/20", text: "text-warning" },
  Beginner: { bg: "bg-card-dark", text: "text-text-muted" },
};

export default function ResumePreviewScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();

  const [result, setResult] = useState<ParsedResume | null>(null);
  const [loading, setLoading] = useState(true);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  const load = useCallback(async (force: boolean) => {
    if (force) {
      setReanalyzing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const data = await parseMyResume(force);
      setResult(data);
    } catch (err: any) {
      setError(err?.message || "Failed to analyze resume. Please try again.");
    } finally {
      setLoading(false);
      setReanalyzing(false);
    }
  }, []);

  useEffect(() => {
    Promise.resolve().then(() => load(false));
  }, [load]);

  const handleUseProfileData = async () => {
    if (!result) return;
    setApplying(true);
    try {
      const bioParts: string[] = [];
      if (result.summary) bioParts.push(result.summary);
      if (result.yearsOfExperience != null) {
        bioParts.push(`${result.yearsOfExperience} years of experience`);
      }
      if (result.masteryLevel) bioParts.push(`Mastery level: ${result.masteryLevel}`);

      await updateWorkerProfileDetails({
        bio: bioParts.join(" · ") || undefined,
        digitalIdTrade: result.tradeCategory || undefined,
      });
      setIsSaved(true);

      const hasSkills = result.parsedSkills.length > 0;
      alertModal.success(
        "Profile Updated",
        hasSkills
          ? "Your trade and bio were updated from your resume. Add the skills listed below from your Skills screen to finish your profile."
          : "Your trade and bio were updated from your resume.",
        hasSkills
          ? [
              { text: "Later", onPress: () => router.back() },
              {
                text: "Add Skills",
                onPress: () => router.push("/(worker)/profile/skills"),
              },
            ]
          : [{ text: "OK", onPress: () => router.back() }],
      );
    } catch (err) {
      console.error("Apply resume profile data error:", err);
      alertModal.error("Error", "Failed to update your profile. Please try again.");
    } finally {
      setApplying(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Resume Analysis" showBack />
        <View className="flex-1 items-center justify-center px-8">
          <ActivityIndicator size="large" color={colors.brand.DEFAULT} />
          <Text className="text-text-secondary text-sm mt-4 text-center">
            Analyzing your resume with AI — this may take a few seconds…
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !result) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Resume Analysis" showBack />
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="alert-circle-outline" size={48} color={colors.text.muted} />
          <Text className="text-text-primary font-semibold text-base mt-4 text-center">
            Couldn&apos;t analyze your resume
          </Text>
          <Text className="text-text-secondary text-sm mt-2 text-center">
            {error || "No analysis is available yet."}
          </Text>
          <View className="mt-6 w-full">
            <PrimaryButton label="Try Again" onPress={() => load(false)} fullWidth />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const hasSkills = result.parsedSkills.length > 0;
  const masteryLevel = result.masteryLevel ?? "Unknown";
  const levelColors = LEVEL_COLOR[masteryLevel] ?? LEVEL_COLOR.Beginner;

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Resume Analysis" showBack />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      >
        {/* AI Header */}
        <View className="bg-accent rounded-2xl p-4 mb-4" style={cardShadow}>
          <View className="flex-row items-center">
            <Ionicons name="sparkles" size={24} color={colors.white} />
            <Text className="text-white font-bold text-base ml-2">
              AI-Powered Resume Analysis
            </Text>
          </View>
          <Text className="text-white/70 text-xs mt-1">
            {result.parsedAt
              ? `Analyzed ${new Date(result.parsedAt).toLocaleDateString()}`
              : "Analyzed just now"}
          </Text>
        </View>

        {/* Profile Overview */}
        <View className="bg-card rounded-2xl p-4 mb-4" style={cardShadow}>
          <Text className="text-text-primary font-bold text-base mb-3">
            Profile Overview
          </Text>
          <View className="flex-row items-center">
            <View className="w-16 h-16 bg-accent/20 rounded-full items-center justify-center mr-4">
              <Ionicons name="person-circle" size={48} color={colors.brand.DEFAULT} />
            </View>
            <View className="flex-1">
              <Text className="text-accent text-sm">
                {result.tradeCategory ?? "Trade not detected"}
              </Text>
              {result.yearsOfExperience != null && (
                <View className="mt-1 flex-row items-center">
                  <Ionicons name="time-outline" size={14} color={colors.text.muted} />
                  <Text className="text-text-secondary text-xs ml-1">
                    {result.yearsOfExperience} years experience
                  </Text>
                </View>
              )}
            </View>
          </View>
          {result.masteryLevel && (
            <View className="mt-3 flex-row items-center justify-between bg-card-dark rounded-xl p-3">
              <View>
                <Text className="text-text-secondary text-xs">Mastery Level</Text>
                <Text className="text-text-primary font-bold text-base mt-0.5">
                  {result.masteryLevel}
                </Text>
              </View>
            </View>
          )}
          {result.summary && (
            <Text className="text-text-secondary text-sm mt-3 leading-5">
              {result.summary}
            </Text>
          )}
        </View>

        {/* Skills */}
        <View className="bg-card rounded-2xl p-4 mb-4" style={cardShadow}>
          <Text className="text-text-primary font-bold text-base mb-3">
            Extracted Skills
          </Text>
          {hasSkills ? (
            result.parsedSkills.map((skill, index) => (
              <View
                key={`${skill}-${index}`}
                className={`flex-row items-center justify-between py-2 ${
                  index < result.parsedSkills.length - 1
                    ? "border-b border-divider"
                    : ""
                }`}
              >
                <Text className="text-text-primary text-sm flex-1">{skill}</Text>
                <View className={`${levelColors.bg} rounded-full px-2 py-0.5`}>
                  <Text className={`${levelColors.text} text-xs font-semibold`}>
                    {masteryLevel}
                  </Text>
                </View>
              </View>
            ))
          ) : (
            <Text className="text-text-muted text-sm">
              No skills could be extracted from this resume.
            </Text>
          )}
        </View>

        {/* Actions */}
        <View className="gap-3 mt-2">
          {isSaved ? (
            <View className="bg-success/10 border border-success rounded-2xl p-4 items-center">
              <Ionicons name="checkmark-circle" size={24} color={colors.success} />
              <Text className="text-success font-semibold mt-2">
                Profile data already applied
              </Text>
            </View>
          ) : (
            <PrimaryButton
              label="Use This Profile Data"
              fullWidth
              loading={applying}
              disabled={applying}
              onPress={handleUseProfileData}
            />
          )}
          <OutlinedButton
            label={reanalyzing ? "Re-analyzing…" : "Re-analyze Resume"}
            onPress={() => load(true)}
            disabled={reanalyzing}
          />
          <OutlinedButton label="Go Back" onPress={() => router.back()} />
          <Text className="text-text-muted text-xs text-center mt-2">
            AI analysis may not be 100% accurate. Review your profile after
            applying.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
