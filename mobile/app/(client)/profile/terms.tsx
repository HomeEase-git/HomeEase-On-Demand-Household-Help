import React from "react";
import { Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import ScreenHeader from "../../../components/ui/ScreenHeader";

export default function TermsScreen() {
  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Terms and Conditions" showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Text className="text-text-primary font-bold text-lg mb-2">
          1. Acceptance
        </Text>
        <Text className="text-text-secondary text-sm mb-4">
          By creating an account and using HomeEase, you agree to be bound by
          these Terms and Conditions. If you do not agree, please do not use
          this platform.
        </Text>

        <Text className="text-text-primary font-bold text-lg mb-2">
          2. Platform Role
        </Text>
        <Text className="text-text-secondary text-sm mb-4">
          HomeEase is a platform that connects clients with independent home
          service workers. We do not employ workers directly and do not
          guarantee the quality of services performed. Each booking is an
          agreement between you and the worker you engage.
        </Text>

        <Text className="text-text-primary font-bold text-lg mb-2">
          3. Booking & Cancellation
        </Text>
        <Text className="text-text-secondary text-sm mb-4">
          When you book a service, you agree to provide accurate details about
          the job, be reasonably available at the scheduled time, and pay for
          completed services. Cancellations made close to the scheduled time
          may be subject to a cancellation fee as shown at checkout.
        </Text>

        <Text className="text-text-primary font-bold text-lg mb-2">
          4. Payment
        </Text>
        <Text className="text-text-secondary text-sm mb-4">
          Payments are processed through our supported payment methods (GCash,
          Maya, or Cash). Amounts charged include the agreed service price and
          any applicable fees disclosed before you confirm a booking. Refunds,
          where applicable, are processed back to the original payment method
          or as platform credit.
        </Text>

        <Text className="text-text-primary font-bold text-lg mb-2">
          5. Client Responsibilities
        </Text>
        <Text className="text-text-secondary text-sm mb-4">
          You agree to treat workers with respect and courtesy, provide a
          safe environment for services to be performed, communicate promptly
          about scheduling changes, and not request services outside the
          scope of what was booked without agreeing on updated pricing.
        </Text>

        <Text className="text-text-primary font-bold text-lg mb-2">
          6. Prohibited Conduct
        </Text>
        <Text className="text-text-secondary text-sm mb-4">
          You must not solicit workers to transact outside the platform,
          submit false reviews or complaints, share another user&apos;s personal
          information without consent, or engage in discriminatory,
          abusive, or harassing behavior toward workers.
        </Text>

        <Text className="text-text-primary font-bold text-lg mb-2">
          7. Account Suspension
        </Text>
        <Text className="text-text-secondary text-sm mb-4">
          HomeEase reserves the right to suspend or permanently ban accounts
          involved in fraud, repeated no-shows, policy violations, or any
          activity deemed harmful to the platform or its users.
        </Text>

        <Text className="text-text-primary font-bold text-lg mb-2">
          8. Governing Law
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
