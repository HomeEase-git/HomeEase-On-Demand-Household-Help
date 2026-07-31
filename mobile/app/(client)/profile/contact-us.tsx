import React, { useState } from "react";
import { View, Text, ScrollView, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import InputField from "../../../components/ui/InputField";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import { colors } from "../../../constants";
import { useToastContext } from "../../../contexts/ToastContext";

const SUPPORT_EMAIL = "support@homeease.com";

export default function ContactUsScreen() {
  const router = useRouter();
  const toast = useToastContext();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const handleSend = async () => {
    if (!subject.trim() || !message.trim()) {
      toast.error("Please fill in all fields");
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
      toast.error("No email app found. Please email us directly at " + SUPPORT_EMAIL);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Contact Us" showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <View className="bg-card rounded-2xl p-4 mb-4">
          <View className="flex-row items-center mb-3">
            <Ionicons
              name="mail-outline"
              size={20}
              color={colors.accent.DEFAULT}
            />
            <Text className="text-primary ml-2">{SUPPORT_EMAIL}</Text>
          </View>
          <View className="flex-row items-center mb-3">
            <Ionicons
              name="call-outline"
              size={20}
              color={colors.accent.DEFAULT}
            />
            <Text className="text-primary ml-2">(044) 123-4567</Text>
          </View>
          <View className="flex-row items-center">
            <Ionicons
              name="time-outline"
              size={20}
              color={colors.accent.DEFAULT}
            />
            <Text className="text-primary ml-2">Mon-Fri 8AM-5PM</Text>
          </View>
        </View>
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
