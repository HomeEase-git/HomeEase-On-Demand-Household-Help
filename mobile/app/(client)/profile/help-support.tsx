import React, { useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import SearchBar from "../../../components/ui/SearchBar";

const FAQ = [
  {
    q: "How do I book a service?",
    a: "Go to Home, pick a category, choose a worker, and follow the booking steps.",
  },
  {
    q: "How do I pay?",
    a: "You can pay via GCash, Maya, bank transfer, or cash on completion.",
  },
  {
    q: "Can I cancel a booking?",
    a: "Yes, from the booking detail screen you can cancel if status is Pending.",
  },
];

export default function HelpSupportScreen() {
  const router = useRouter();
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Help & Support" showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <SearchBar placeholder="Search FAQ..." />
        <View className="mt-4">
          {FAQ.map((item, i) => (
            <Pressable
              key={i}
              className="bg-card rounded-xl p-4 mb-2"
              onPress={() => setExpanded(expanded === i ? null : i)}
            >
              <View className="flex-row justify-between items-center">
                <Text className="text-brand font-semibold flex-1">
                  {item.q}
                </Text>
                <Text className="text-accent">
                  {expanded === i ? "−" : "+"}
                </Text>
              </View>
              {expanded === i && (
                <Text className="text-text-secondary text-sm mt-2">
                  {item.a}
                </Text>
              )}
            </Pressable>
          ))}
        </View>
        <Pressable
          className="bg-card rounded-xl p-4 mt-4"
          onPress={() => router.push("/(client)/profile/contact-us")}
        >
          <Text className="text-brand font-semibold">Contact Us</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
