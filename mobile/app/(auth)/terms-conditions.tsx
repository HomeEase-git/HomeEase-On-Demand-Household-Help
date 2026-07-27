import React from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../components/ui/ScreenHeader";
import PrimaryButton from "../../components/ui/PrimaryButton";

export default function TermsConditionsScreen() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Terms & Conditions" showBack />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 24, paddingVertical: 16 }}
      >
        <Text className="text-text-primary text-2xl font-bold mb-6">
          Terms and Conditions
        </Text>

        <Text className="text-text-secondary text-sm mb-4">
          Last Updated: June 2024
        </Text>

        <Section
          title="1. Acceptance of Terms"
          content="By accessing and using HomeEase, you accept and agree to be bound by the terms and provision of this agreement. If you do not agree to abide by the above, please do not use this service."
        />

        <Section
          title="2. Use License"
          content="Permission is granted to temporarily download one copy of the materials (information or software) on HomeEase for personal, non-commercial transitory viewing only. This is the grant of a license, not a transfer of title, and under this license you may not:"
        />

        <BulletList
          items={[
            "Modify or copy the materials",
            "Use the materials for any commercial purpose or for any public display",
            "Attempt to decompile or reverse engineer any software contained on HomeEase",
            "Remove any copyright or other proprietary notations from the materials",
            "Transfer the materials to another person or 'mirror' the materials on any other server",
          ]}
        />

        <Section
          title="3. Disclaimer"
          content="The materials on HomeEase are provided on an 'as is' basis. HomeEase makes no warranties, expressed or implied, and hereby disclaims and negates all other warranties including, without limitation, implied warranties or conditions of merchantability, fitness for a particular purpose, or non-infringement of intellectual property or other violation of rights."
        />

        <Section
          title="4. Limitations"
          content="In no event shall HomeEase or its suppliers be liable for any damages (including, without limitation, damages for loss of data or profit, or due to business interruption) arising out of the use or inability to use the materials on HomeEase, even if HomeEase or an authorized representative has been notified orally or in writing of the possibility of such damage."
        />

        <Section
          title="5. Accuracy of Materials"
          content="The materials appearing on HomeEase could include technical, typographical, or photographic errors. HomeEase does not warrant that any of the materials on this website are accurate, complete, or current. HomeEase may make changes to the materials contained on this website at any time without notice."
        />

        <Section
          title="6. Links"
          content="HomeEase has not reviewed all of the sites linked to its website and is not responsible for the contents of any such linked site. The inclusion of any link does not imply endorsement by HomeEase of the site. Use of any such linked website is at the user's own risk."
        />

        <Section
          title="7. Modifications"
          content="HomeEase may revise these terms of service for its website at any time without notice. By using this website, you are agreeing to be bound by the then current version of these terms of service."
        />

        <Section
          title="8. Governing Law"
          content="These terms and conditions are governed by and construed in accordance with the laws of the jurisdiction in which HomeEase operates, and you irrevocably submit to the exclusive jurisdiction of the courts in that location."
        />

        <Section
          title="9. User Responsibilities"
          content="Users of HomeEase agree to:"
        />

        <BulletList
          items={[
            "Provide accurate and complete information during registration",
            "Maintain the confidentiality of their account credentials",
            "Use the service only for lawful purposes",
            "Not engage in any abusive or harassing behavior",
            "Comply with all applicable laws and regulations",
          ]}
        />

        <Section
          title="10. Payment Terms"
          content="If you engage in a transaction through HomeEase, you agree to pay all charges incurred in connection with that transaction at the rates in effect when the charges are incurred."
        />

        <View className="mt-8 p-4 bg-blue-50 rounded-lg">
          <Text className="text-text-secondary text-xs">
            For questions about these Terms and Conditions, please contact our
            support team at{" "}
            <Text className="text-accent font-semibold">
              support@homeease.com
            </Text>
          </Text>
        </View>

        <View className="mt-8">
          <PrimaryButton
            label="I Understand and Accept"
            fullWidth
            onPress={() => router.back()}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, content }: { title: string; content: string }) {
  return (
    <View className="mb-6">
      <Text className="text-text-primary text-base font-bold mb-2">{title}</Text>
      <Text className="text-text-secondary text-sm leading-6">{content}</Text>
    </View>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <View className="mb-6 pl-4">
      {items.map((item, index) => (
        <View key={index} className="flex-row mb-2">
          <Text className="text-accent font-bold mr-2">•</Text>
          <Text className="text-text-secondary text-sm flex-1 leading-5">
            {item}
          </Text>
        </View>
      ))}
    </View>
  );
}
