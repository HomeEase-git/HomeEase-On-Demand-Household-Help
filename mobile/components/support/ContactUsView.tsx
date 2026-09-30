import React, { useState } from "react";
import { View, Text, Pressable, Linking, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { KeyboardAwareScrollView } from "../ui/KeyboardAwareScrollView";
import ScreenHeader from "../ui/ScreenHeader";
import InputField from "../ui/InputField";
import PrimaryButton from "../ui/PrimaryButton";
import { colors, cardShadow } from "../../constants";
import { useAlertModal } from "../../contexts/AlertModalContext";
import { useAuthStore } from "../../store/authStore";
import {
  CONTACT_TOPICS,
  SUPPORT_CHANNELS,
  type IconName,
  type SupportRole,
} from "../../constants/supportContent";

type Props = { role: SupportRole };

type Channel = { icon: IconName; label: string; value: string; onPress?: () => void };

export function ContactUsView({ role }: Props) {
  const router = useRouter();
  const alertModal = useAlertModal();
  const user = useAuthStore((s) => s.user);
  const [topic, setTopic] = useState<string | null>(null);
  const [bookingRef, setBookingRef] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const openUrl = (url: string, fallback: string) =>
    Linking.openURL(url).catch(() => alertModal.error("Couldn't open", fallback));

  const channels: Channel[] = [
    {
      icon: "mail-outline",
      label: "Email",
      value: SUPPORT_CHANNELS.email,
      onPress: () =>
        openUrl(
          `mailto:${SUPPORT_CHANNELS.email}`,
          `No email app found. Please email us at ${SUPPORT_CHANNELS.email}.`,
        ),
    },
    ...(SUPPORT_CHANNELS.phone
      ? [
          {
            icon: "call-outline" as const,
            label: "Phone",
            value: SUPPORT_CHANNELS.phone,
            onPress: () =>
              openUrl(
                `tel:${SUPPORT_CHANNELS.phone!.replace(/[^\d+]/g, "")}`,
                `Please call us at ${SUPPORT_CHANNELS.phone}.`,
              ),
          },
        ]
      : []),
    ...(SUPPORT_CHANNELS.facebookUrl
      ? [
          {
            icon: "logo-facebook" as const,
            label: "Facebook",
            value: "Message us on Facebook",
            onPress: () =>
              openUrl(SUPPORT_CHANNELS.facebookUrl!, "Could not open Facebook."),
          },
        ]
      : []),
    { icon: "time-outline", label: "Support hours", value: SUPPORT_CHANNELS.hours },
  ];

  const handleSend = async () => {
    if (!topic) {
      alertModal.error("Choose a topic", "Pick what your message is about.");
      return;
    }
    if (!message.trim()) {
      alertModal.error("Message required", "Tell us how we can help.");
      return;
    }

    const fullSubject = `[${topic}] ${subject.trim() || topic}`;
    // Account details help support find the user without a back-and-forth.
    const details = [
      "---",
      user ? `Account: ${user.email} (${role}, ID ${user.id})` : `Account: not signed in (${role})`,
      bookingRef.trim() ? `Booking ID: ${bookingRef.trim()}` : null,
      `App version: ${Constants.expoConfig?.version ?? "unknown"} (${Platform.OS} ${Platform.Version})`,
    ]
      .filter(Boolean)
      .join("\n");
    const body = `${message.trim()}\n\n${details}`;

    const mailUrl = `mailto:${SUPPORT_CHANNELS.email}?subject=${encodeURIComponent(
      fullSubject,
    )}&body=${encodeURIComponent(body)}`;

    try {
      await Linking.openURL(mailUrl);
      router.back();
    } catch (error) {
      console.error("Open mail client error:", error);
      alertModal.error(
        "No email app found",
        `Please email us directly at ${SUPPORT_CHANNELS.email}.`,
      );
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Contact Us" showBack />
      <KeyboardAwareScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
        <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide mb-1">
          Get in Touch
        </Text>
        <View className="bg-card rounded-2xl overflow-hidden" style={cardShadow}>
          {channels.map((c, i) => (
            <Pressable
              key={c.label}
              disabled={!c.onPress}
              onPress={c.onPress}
              className={`flex-row items-center py-3.5 px-4 ${
                i < channels.length - 1 ? "border-b border-divider" : ""
              }`}
            >
              <View className="w-9 h-9 rounded-full bg-accent/10 items-center justify-center mr-3">
                <Ionicons name={c.icon} size={18} color={colors.accent.DEFAULT} />
              </View>
              <View className="flex-1">
                <Text className="text-text-muted text-xs">{c.label}</Text>
                <Text className="text-text-primary">{c.value}</Text>
              </View>
              {c.onPress && (
                <Ionicons name="open-outline" size={18} color={colors.text.muted} />
              )}
            </Pressable>
          ))}
        </View>
        <Text className="text-text-muted text-xs mt-2 mb-5 px-1">
          {SUPPORT_CHANNELS.responseTime} If you&apos;re in danger, call 911 first.
        </Text>

        <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide mb-1">
          Send a Message
        </Text>
        <View className="bg-card rounded-2xl p-4" style={cardShadow}>
          <Text className="text-text-primary text-sm font-medium mb-2">
            What is this about?
          </Text>
          <View className="flex-row flex-wrap mb-4" style={{ gap: 8 }}>
            {CONTACT_TOPICS[role].map((t) => {
              const active = topic === t;
              return (
                <Pressable
                  key={t}
                  onPress={() => setTopic(t)}
                  className={`px-3 py-1.5 rounded-full border ${
                    active ? "bg-accent border-accent" : "bg-white border-divider"
                  }`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <Text
                    className={`text-sm ${active ? "text-white font-semibold" : "text-text-secondary"}`}
                  >
                    {t}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <InputField
            label="Booking ID (optional)"
            value={bookingRef}
            onChangeText={setBookingRef}
            placeholder="e.g. #A1B2C3"
          />
          <InputField
            label="Subject (optional)"
            value={subject}
            onChangeText={setSubject}
            placeholder="Short summary"
          />
          <InputField
            label="Message"
            value={message}
            onChangeText={setMessage}
            placeholder="Tell us what happened..."
            multiline
          />
          <PrimaryButton label="Send via Email" fullWidth onPress={handleSend} />
          <Text className="text-text-muted text-xs text-center mt-3">
            Opens your email app. Your account email and app version are added so we can
            help faster.
          </Text>
        </View>

        <Pressable
          className="flex-row items-center mt-5 px-1"
          onPress={() =>
            openUrl(
              `mailto:${SUPPORT_CHANNELS.privacyEmail}?subject=${encodeURIComponent(
                "Data privacy request",
              )}`,
              `Please email ${SUPPORT_CHANNELS.privacyEmail}.`,
            )
          }
        >
          <Ionicons name="shield-outline" size={16} color={colors.text.muted} />
          <Text className="text-text-secondary text-xs ml-2 flex-1">
            Data privacy requests (access, correction, deletion):{" "}
            <Text className="text-accent font-semibold">{SUPPORT_CHANNELS.privacyEmail}</Text>
          </Text>
        </Pressable>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

export default ContactUsView;
