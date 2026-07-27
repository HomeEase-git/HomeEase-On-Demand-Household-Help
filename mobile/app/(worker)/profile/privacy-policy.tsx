import React from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import ScreenHeader from "../../../components/ui/ScreenHeader";

export default function WorkerPrivacyPolicyScreen() {
  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Privacy Policy" showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Text className="text-text-primary font-bold text-lg mb-2">
          Data We Collect
        </Text>
        <Text className="text-text-secondary text-sm mb-4">
          We collect information you provide when registering, completing KYC
          verification, and communicating with clients. This includes your name,
          email, phone number, address, government ID, selfie photo, resume, and
          professional certifications.
        </Text>

        <Text className="text-text-primary font-bold text-lg mb-2">
          How We Use It
        </Text>
        <Text className="text-text-secondary text-sm mb-4">
          Your data is used to verify your identity, display your public
          professional profile to clients, facilitate bookings, process payouts,
          and improve our platform services. Your submitted documents and resume
          are visible on your public profile to help clients make informed
          decisions.
        </Text>

        <Text className="text-text-primary font-bold text-lg mb-2">
          Document Visibility
        </Text>
        <Text className="text-text-secondary text-sm mb-4">
          By submitting documents through HomeEase, you consent to having your
          certifications, resume summary, and verification badges displayed
          publicly on your worker profile. HomeEase does not independently
          verify the authenticity of submitted documents but reserves the right
          to remove profiles found to contain fraudulent information.
        </Text>

        <Text className="text-text-primary font-bold text-lg mb-2">
          Payout Information
        </Text>
        <Text className="text-text-secondary text-sm mb-4">
          Your linked GCash, Maya, or bank account details are used solely for
          processing your earnings payouts. HomeEase does not store full account
          credentials and uses secure payment infrastructure to process
          transfers.
        </Text>

        <Text className="text-text-primary font-bold text-lg mb-2">Security</Text>
        <Text className="text-text-secondary text-sm mb-4">
          We use industry-standard encryption and security measures to protect
          your personal and financial information. You are responsible for
          keeping your account credentials confidential.
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
