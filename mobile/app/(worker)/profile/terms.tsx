import React from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import ScreenHeader from "../../../components/ui/ScreenHeader";

export default function WorkerTermsScreen() {
  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Terms and Conditions" showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Text className="text-text-primary font-bold text-lg mb-2">
          1. Acceptance
        </Text>
        <Text className="text-text-secondary text-sm mb-4">
          By registering as a service worker on HomeEase, you agree to be bound
          by these Terms and Conditions. If you do not agree, please do not use
          this platform.
        </Text>

        <Text className="text-text-primary font-bold text-lg mb-2">
          2. Platform Role
        </Text>
        <Text className="text-text-secondary text-sm mb-4">
          HomeEase is an intermediary platform that connects independent service
          workers with clients. HomeEase does not employ workers directly. You
          operate as an independent contractor and are solely responsible for
          the quality and completion of services you provide.
        </Text>

        <Text className="text-text-primary font-bold text-lg mb-2">
          3. Worker Responsibilities
        </Text>
        <Text className="text-text-secondary text-sm mb-4">
          You agree to provide services professionally and punctually, maintain
          all required licenses and certifications applicable to your trade,
          treat clients with respect and courtesy, and communicate promptly
          regarding any scheduling changes or issues.
        </Text>

        <Text className="text-text-primary font-bold text-lg mb-2">
          4. Commission & Payouts
        </Text>
        <Text className="text-text-secondary text-sm mb-4">
          HomeEase retains a service commission of 10% from each completed
          transaction. You receive 90% of the agreed service price. Applicable
          withholding taxes on professional fees may also be deducted in
          accordance with BIR regulations. Payouts are processed within 24–48
          hours of job completion and service verification.
        </Text>

        <Text className="text-text-primary font-bold text-lg mb-2">
          5. Prohibited Conduct
        </Text>
        <Text className="text-text-secondary text-sm mb-4">
          You must not solicit clients to transact outside the platform,
          misrepresent your qualifications or experience, share client personal
          information with third parties, submit fraudulent documents, or engage
          in discriminatory or harassing behavior toward clients.
        </Text>

        <Text className="text-text-primary font-bold text-lg mb-2">
          6. Account Suspension
        </Text>
        <Text className="text-text-secondary text-sm mb-4">
          HomeEase reserves the right to suspend or permanently ban accounts
          involved in fraud, repeated client complaints, policy violations, or
          any activity deemed harmful to the platform or its users.
        </Text>

        <Text className="text-text-primary font-bold text-lg mb-2">
          7. Governing Law
        </Text>
        <Text className="text-text-secondary text-sm mb-4">
          These terms are governed by the laws of the Republic of the
          Philippines. Disputes shall be resolved in the appropriate courts of
          Bulacan province.
        </Text>

        <Text className="text-text-muted text-xs text-center mt-4">
          Last updated: June 2026
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
