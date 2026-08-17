import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { AppIcon as Ionicons } from "../../../components/icons/AppIcon";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import { colors, cardShadow } from "../../../constants";
import * as api from "../../../services/api";
import { useAlertModal } from "../../../contexts/AlertModalContext";

export default function WorkerNotificationPreferencesScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const [booking, setBooking] = useState(true);
  const [messages, setMessages] = useState(true);
  const [promos, setPromos] = useState(false);
  const [system, setSystem] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const profile = await api.getUserProfile();
        const prefs = profile.notificationPreferences;
        if (prefs) {
          if (typeof prefs.bookingUpdates === "boolean") setBooking(prefs.bookingUpdates);
          if (typeof prefs.messages === "boolean") setMessages(prefs.messages);
          if (typeof prefs.promotions === "boolean") setPromos(prefs.promotions);
          if (typeof prefs.systemNotifications === "boolean") setSystem(prefs.systemNotifications);
        }
      } catch (error) {
        console.error("Load notification preferences error:", error);
      }
    };

    loadPreferences();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateNotificationPreferences({
        bookingUpdates: booking,
        messages,
        promotions: promos,
        systemNotifications: system,
      });
      alertModal.success("Saved", "Preferences updated", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (error) {
      console.error("Save notification preferences error:", error);
      alertModal.error("Error", "Unable to save preferences right now.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Notifications" showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide mb-1">
          Notify me about
        </Text>
        <View className="bg-card rounded-2xl overflow-hidden" style={cardShadow}>
          {(
            [
              { label: "Booking Updates", icon: "calendar-outline", value: booking, set: setBooking },
              { label: "New Messages", icon: "chatbubble-ellipses-outline", value: messages, set: setMessages },
              { label: "Promotions & Offers", icon: "pricetag-outline", value: promos, set: setPromos },
              { label: "System Announcements", icon: "megaphone-outline", value: system, set: setSystem },
            ] as const
          ).map((item) => (
            <View
              key={item.label}
              className="flex-row items-center py-3.5 px-4 border-b border-divider last:border-0"
            >
              <View className="w-9 h-9 rounded-full bg-accent/10 items-center justify-center mr-3">
                <Ionicons name={item.icon} size={18} color={colors.accent.DEFAULT} />
              </View>
              <Text className="text-text-primary flex-1">{item.label}</Text>
              <Switch
                value={item.value}
                onValueChange={item.set}
                trackColor={{ false: colors.toggleOff, true: colors.brand.DEFAULT }}
                thumbColor={colors.white}
              />
            </View>
          ))}
        </View>
        <View className="mt-6">
          <PrimaryButton
            label="Save Preferences"
            fullWidth
            onPress={handleSave}
            loading={saving}
            disabled={saving}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
