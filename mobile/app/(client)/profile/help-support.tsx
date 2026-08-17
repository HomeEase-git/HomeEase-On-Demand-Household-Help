import React, { useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import SearchBar from "../../../components/ui/SearchBar";
import { colors, cardShadow } from "../../../constants";

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

        <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide mt-5 mb-1">
          Frequently Asked Questions
        </Text>
        <View className="bg-card rounded-2xl overflow-hidden" style={cardShadow}>
          {FAQ.map((item, i) => (
            <Pressable
              key={i}
              className="p-4 border-b border-divider last:border-0"
              onPress={() => setExpanded(expanded === i ? null : i)}
            >
              <View className="flex-row items-center">
                <View className="w-9 h-9 rounded-full bg-accent/10 items-center justify-center mr-3">
                  <Ionicons name="help-circle-outline" size={18} color={colors.accent.DEFAULT} />
                </View>
                <Text className="text-text-primary font-semibold flex-1">
                  {item.q}
                </Text>
                <Ionicons
                  name={expanded === i ? "chevron-up" : "chevron-down"}
                  size={18}
                  color={colors.text.muted}
                />
              </View>
              {expanded === i && (
                <Text className="text-text-secondary text-sm mt-2 ml-12">
                  {item.a}
                </Text>
              )}
            </Pressable>
          ))}
        </View>

        <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide mt-5 mb-1">
          Still Need Help?
        </Text>
        <View className="bg-card rounded-2xl overflow-hidden" style={cardShadow}>
          <Pressable
            className="flex-row items-center p-4"
            onPress={() => router.push("/(client)/profile/contact-us")}
          >
            <View className="w-9 h-9 rounded-full bg-accent/10 items-center justify-center mr-3">
              <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.accent.DEFAULT} />
            </View>
            <Text className="text-text-primary font-semibold flex-1">Contact Us</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.text.muted} />
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
