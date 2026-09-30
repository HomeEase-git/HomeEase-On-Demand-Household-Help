import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import ScreenHeader from "../ui/ScreenHeader";
import SearchBar from "../ui/SearchBar";
import { colors, cardShadow } from "../../constants";
import {
  CLIENT_FAQ,
  WORKER_FAQ,
  SUPPORT_CHANNELS,
  type IconName,
  type SupportRole,
} from "../../constants/supportContent";

type Props = { role: SupportRole };

export function HelpSupportView({ role }: Props) {
  const router = useRouter();
  const categories = role === "client" ? CLIENT_FAQ : WORKER_FAQ;
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  // Keyed by question text so an open answer stays open while filtering.
  const [expanded, setExpanded] = useState<string | null>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return categories
      .filter((c) => !activeCategory || c.title === activeCategory)
      .map((c) => ({
        ...c,
        items: needle
          ? c.items.filter(
              (item) =>
                item.q.toLowerCase().includes(needle) ||
                item.a.toLowerCase().includes(needle),
            )
          : c.items,
      }))
      .filter((c) => c.items.length > 0);
  }, [categories, query, activeCategory]);

  const contactPath =
    role === "client" ? "/(client)/profile/contact-us" : "/(worker)/profile/contact-us";
  const bookingsPath = role === "client" ? "/(client)/booking" : "/(worker)/records";

  const helpLinks: { label: string; sub: string; icon: IconName; onPress: () => void }[] = [
    {
      label: "Contact Us",
      sub: "Send us a message",
      icon: "chatbubble-ellipses-outline",
      onPress: () => router.push(contactPath),
    },
    {
      label: role === "client" ? "My bookings" : "My jobs",
      sub:
        role === "client"
          ? "Cancel, reschedule or review a quote"
          : "Cancel or reschedule a job",
      icon: "calendar-outline",
      onPress: () => router.push(bookingsPath),
    },
    {
      label: "Email support",
      sub: SUPPORT_CHANNELS.email,
      icon: "mail-outline",
      onPress: () => {
        Linking.openURL(`mailto:${SUPPORT_CHANNELS.email}`).catch(() => {});
      },
    },
  ];

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Help & Support" showBack />
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
        <SearchBar placeholder="Search FAQ..." value={query} onChangeText={setQuery} />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-4 -mx-6"
          contentContainerStyle={{ paddingHorizontal: 24, gap: 8 }}
        >
          {[null, ...categories.map((c) => c.title)].map((title) => {
            const active = activeCategory === title;
            return (
              <Pressable
                key={title ?? "all"}
                onPress={() => setActiveCategory(title)}
                className={`px-4 py-2 rounded-full border ${
                  active ? "bg-accent border-accent" : "bg-card border-divider"
                }`}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text
                  className={`text-sm font-semibold ${
                    active ? "text-white" : "text-text-secondary"
                  }`}
                >
                  {title ?? "All"}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {visible.length === 0 ? (
          <View className="items-center py-10">
            <Ionicons name="search-outline" size={32} color={colors.text.muted} />
            <Text className="text-text-secondary text-sm mt-2 text-center">
              No answers match &quot;{query}&quot;.{"\n"}Try another word, or contact us below.
            </Text>
          </View>
        ) : (
          visible.map((category) => (
            <View key={category.title}>
              <View className="flex-row items-center mt-5 mb-1">
                <Ionicons name={category.icon} size={14} color={colors.text.muted} />
                <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide ml-1.5">
                  {category.title}
                </Text>
              </View>
              <View className="bg-card rounded-2xl overflow-hidden" style={cardShadow}>
                {category.items.map((item, i) => {
                  const key = `${category.title}:${item.q}`;
                  const open = expanded === key;
                  return (
                    <Pressable
                      key={key}
                      className={`p-4 ${
                        i < category.items.length - 1 ? "border-b border-divider" : ""
                      }`}
                      onPress={() => setExpanded(open ? null : key)}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: open }}
                    >
                      <View className="flex-row items-center">
                        <Text className="text-text-primary font-semibold flex-1 pr-2">
                          {item.q}
                        </Text>
                        <Ionicons
                          name={open ? "chevron-up" : "chevron-down"}
                          size={18}
                          color={colors.text.muted}
                        />
                      </View>
                      {open && (
                        <Text className="text-text-secondary text-sm mt-2 leading-5">
                          {item.a}
                        </Text>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))
        )}

        <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide mt-6 mb-1">
          Still Need Help?
        </Text>
        <View className="bg-card rounded-2xl overflow-hidden" style={cardShadow}>
          {helpLinks.map((link, i) => (
            <Pressable
              key={link.label}
              className={`flex-row items-center py-3.5 px-4 ${
                i < helpLinks.length - 1 ? "border-b border-divider" : ""
              }`}
              onPress={link.onPress}
            >
              <View className="w-9 h-9 rounded-full bg-accent/10 items-center justify-center mr-3">
                <Ionicons name={link.icon} size={18} color={colors.accent.DEFAULT} />
              </View>
              <View className="flex-1">
                <Text className="text-text-primary font-semibold">{link.label}</Text>
                <Text className="text-text-secondary text-xs mt-0.5">{link.sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.text.muted} />
            </Pressable>
          ))}
        </View>
        <Text className="text-text-muted text-xs text-center mt-4">
          {SUPPORT_CHANNELS.hours} · {SUPPORT_CHANNELS.responseTime}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

export default HelpSupportView;
