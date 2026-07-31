import React, { useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../../components/icons/AppIcon";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import InputField from "../../../components/ui/InputField";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import { colors } from "../../../constants";
import { useAlertModal } from "../../../contexts/AlertModalContext";

export default function WorkerContactUsScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const handleSend = () => {
    if (!subject.trim() || !message.trim()) {
      alertModal.error("Error", "Please fill in all fields");
      return;
    }
    alertModal.success("Sent", "We'll reply within 24hrs");
    router.back();
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
              color={colors.brand.DEFAULT}
            />
            <Text className="text-primary ml-2">support@homeease.com</Text>
          </View>
          <View className="flex-row items-center mb-3">
            <Ionicons
              name="call-outline"
              size={20}
              color={colors.brand.DEFAULT}
            />
            <Text className="text-primary ml-2">(044) 123-4567</Text>
          </View>
          <View className="flex-row items-center">
            <Ionicons
              name="time-outline"
              size={20}
              color={colors.brand.DEFAULT}
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
        <PrimaryButton label="Send Message" fullWidth onPress={handleSend} />
      </ScrollView>
    </SafeAreaView>
  );
}
