import React from "react";
import { Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import ScreenHeader from "../../../components/ui/ScreenHeader";

export default function PrivacyPolicyScreen() {
  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Privacy Policy" showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Text className="text-text-primary font-bold text-lg mb-2">
          Data We Collect
        </Text>
        <Text className="text-text-secondary text-sm mb-4">
          We collect information you provide when registering, booking a
          service, and communicating with workers. This includes your name,
          email, phone number, delivery/service addresses, and payment
          details.
        </Text>

        <Text className="text-text-primary font-bold text-lg mb-2">
          How We Use It
        </Text>
        <Text className="text-text-secondary text-sm mb-4">
          Your data is used to facilitate bookings, match you with available
          workers, process payments, send booking updates, and improve our
          platform services.
        </Text>

        <Text className="text-text-primary font-bold text-lg mb-2">
          Information Shared With Workers
        </Text>
        <Text className="text-text-secondary text-sm mb-4">
          When you make a booking, the assigned worker can see the details
          needed to complete the job, such as your name, service address, and
          contact number. Workers do not have access to your saved payment
          method details.
        </Text>

        <Text className="text-text-primary font-bold text-lg mb-2">
          Payment Information
        </Text>
        <Text className="text-text-secondary text-sm mb-4">
          Payments made through GCash or Maya are processed by our secure
          payment partner. HomeEase does not store your full card, GCash, or
          Maya account credentials on its servers.
        </Text>

        <Text className="text-text-primary font-bold text-lg mb-2">
          Security
        </Text>
        <Text className="text-text-secondary text-sm mb-4">
          We use industry-standard encryption and security measures to
          protect your personal information. You are responsible for keeping
          your account credentials confidential.
        </Text>

        <Text className="text-text-primary font-bold text-lg mb-2">
          Your Rights (RA 10173)
        </Text>
        <Text className="text-text-secondary text-sm mb-4">
          Under the Philippine Data Privacy Act of 2012, you have the right to
          access, correct, and request deletion of your personal data. To
          exercise these rights, contact us at support@homeease.com.
        </Text>

        <Text className="text-text-muted text-xs text-center mt-4">
          Last updated: June 2026
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
