import React from "react";
import { View, Text, ScrollView, Pressable, Share, Linking, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import ScreenHeader from "../ui/ScreenHeader";
import { colors, cardShadow } from "../../constants";
import { useAlertModal } from "../../contexts/AlertModalContext";
import {
  ABOUT_CONTENT,
  DEVELOPER_CREDIT,
  PLAY_STORE_URL,
  type IconName,
  type SupportRole,
} from "../../constants/supportContent";

type Props = { role: SupportRole };

export function AboutView({ role }: Props) {
  const router = useRouter();
  const alertModal = useAlertModal();
  const content = ABOUT_CONTENT[role];
  const base = role === "client" ? "/(client)/profile" : "/(worker)/profile";

  const version = Constants.expoConfig?.version ?? "1.0.0";
  // Short OTA update id, so support can tell which JS bundle a user is on.
  const updateTag = Updates.updateId ? ` · update ${Updates.updateId.slice(0, 8)}` : "";

  const links: { label: string; icon: IconName; onPress: () => void }[] = [
    {
      label: "Rate the App",
      icon: "star-outline",
      onPress: () =>
        Linking.openURL(PLAY_STORE_URL).catch(() =>
          alertModal.error("Error", "Could not open the Play Store."),
        ),
    },
    {
      label: "Share HomeEase",
      icon: "share-social-outline",
      onPress: () =>
        Share.share({
          message:
            role === "client"
              ? `I book verified home service workers on HomeEase — check it out! ${PLAY_STORE_URL}`
              : `I find home service jobs on HomeEase — check it out! ${PLAY_STORE_URL}`,
        }).catch(() => {}),
    },
    {
      label: "Help & FAQs",
      icon: "help-circle-outline",
      onPress: () => router.push(`${base}/help-support`),
    },
    {
      label: "Contact Us",
      icon: "chatbubble-ellipses-outline",
      onPress: () => router.push(`${base}/contact-us`),
    },
    {
      label: "Terms and Conditions",
      icon: "document-text-outline",
      onPress: () => router.push(`${base}/terms`),
    },
    {
      label: "Privacy Policy",
      icon: "shield-outline",
      onPress: () => router.push(`${base}/privacy-policy`),
    },
  ];

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="About HomeEase" showBack />
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
        <View className="items-center">
          {/* The logo includes the "HomeEase" wordmark, so no separate title. */}
          <Image
            source={require("../../assets/images/logo/home_ease-logo.png")}
            style={{ width: 160, height: 152 }}
            resizeMode="contain"
            accessibilityLabel="HomeEase logo"
          />
          <Text className="text-text-secondary mt-1">On-Demand Household Help</Text>
          <Text className="text-text-muted text-sm mt-1">
            Version {version}
            {updateTag}
          </Text>
        </View>

        <View className="bg-card rounded-2xl p-4 mt-6" style={cardShadow}>
          <Text className="text-text-secondary text-center leading-5">{content.intro}</Text>
        </View>

        <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide mt-6 mb-1">
          Why HomeEase
        </Text>
        <View className="flex-row flex-wrap" style={{ gap: 12 }}>
          {content.highlights.map((h) => (
            <View
              key={h.title}
              className="bg-card rounded-2xl p-4"
              style={[cardShadow, { flexBasis: "47%", flexGrow: 1 }]}
            >
              <View className="w-9 h-9 rounded-full bg-accent/10 items-center justify-center mb-2">
                <Ionicons name={h.icon} size={18} color={colors.accent.DEFAULT} />
              </View>
              <Text className="text-text-primary font-semibold">{h.title}</Text>
              <Text className="text-text-secondary text-xs mt-1 leading-4">{h.body}</Text>
            </View>
          ))}
        </View>

        <View className="bg-card rounded-2xl mt-6 overflow-hidden" style={cardShadow}>
          {links.map((link, index) => (
            <Pressable
              key={link.label}
              className={`flex-row items-center py-3.5 px-4 ${
                index < links.length - 1 ? "border-b border-divider" : ""
              }`}
              onPress={link.onPress}
            >
              <View className="w-9 h-9 rounded-full bg-accent/10 items-center justify-center mr-3">
                <Ionicons name={link.icon} size={18} color={colors.accent.DEFAULT} />
              </View>
              <Text className="text-text-primary flex-1">{link.label}</Text>
              <Ionicons name="chevron-forward" size={20} color={colors.text.muted} />
            </Pressable>
          ))}
        </View>

        <Text className="text-text-muted text-xs text-center mt-8">
          © {new Date().getFullYear()} HomeEase. All rights reserved.
        </Text>
        <Text className="text-text-muted text-xs text-center mt-1">{DEVELOPER_CREDIT}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

export default AboutView;
