import React, { useState } from "react";
import { View, Text, ScrollView, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../../components/icons/AppIcon";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import InputField from "../../../components/ui/InputField";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import { colors, cardShadow } from "../../../constants";
import { useAlertModal } from "../../../contexts/AlertModalContext";

const SUPPORT_EMAIL = "support@homeease.com";

export default function WorkerContactUsScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const handleSend = async () => {
    if (!subject.trim() || !message.trim()) {
      alertModal.error("Error", "Please fill in all fields");
      return;
    }

    const mailUrl = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
      subject.trim(),
    )}&body=${encodeURIComponent(message.trim())}`;

    try {
      await Linking.openURL(mailUrl);
      router.back();
    } catch (error) {
      console.error("Open mail client error:", error);
      alertModal.error("Error", "No email app found. Please email us directly at " + SUPPORT_EMAIL);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Contact Us" showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide mb-1">
          Reach Us
        </Text>
        <View className="bg-card rounded-2xl mb-6 overflow-hidden" style={cardShadow}>
          <View className="flex-row items-center py-3.5 px-4 border-b border-divider">
            <View className="w-9 h-9 rounded-full bg-accent/10 items-center justify-center mr-3">
              <Ionicons name="mail-outline" size={18} color={colors.accent.DEFAULT} />
            </View>
            <Text className="text-text-primary flex-1">support@homeease.com</Text>
          </View>
          <View className="flex-row items-center py-3.5 px-4 border-b border-divider">
            <View className="w-9 h-9 rounded-full bg-accent/10 items-center justify-center mr-3">
              <Ionicons name="call-outline" size={18} color={colors.accent.DEFAULT} />
            </View>
            <Text className="text-text-primary flex-1">(044) 123-4567</Text>
          </View>
          <View className="flex-row items-center py-3.5 px-4">
            <View className="w-9 h-9 rounded-full bg-accent/10 items-center justify-center mr-3">
              <Ionicons name="time-outline" size={18} color={colors.accent.DEFAULT} />
            </View>
            <Text className="text-text-primary flex-1">Mon-Fri 8AM-5PM</Text>
          </View>
        </View>
        <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide mb-1">
          Send a Message
        </Text>
        <InputField
          label="Subject"
          value={subject}
          onChangeText={setSubject}
          placeholder="Subject"
        />
        <InputField
          label="Message"
          value={message}
          onChangeText={setMessage}
          placeholder="Your message..."
          multiline
        />
        <PrimaryButton label="Send via Email" fullWidth onPress={handleSend} />
      </ScrollView>
    </SafeAreaView>
  );
}
