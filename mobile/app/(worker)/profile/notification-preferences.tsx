import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, Switch, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import { colors } from "../../../constants";
import * as api from "../../../services/api";

export default function WorkerNotificationPreferencesScreen() {
  const router = useRouter();
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
      Alert.alert("Saved", "Preferences updated");
      router.back();
    } catch (error) {
      console.error("Save notification preferences error:", error);
      Alert.alert("Error", "Unable to save preferences right now.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Notifications" showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <View className="bg-card rounded-2xl overflow-hidden">
          {[
            { label: "Booking Updates", value: booking, set: setBooking },
            { label: "New Messages", value: messages, set: setMessages },
            { label: "Promotions & Offers", value: promos, set: setPromos },
            { label: "System Announcements", value: system, set: setSystem },
          ].map((item) => (
            <View
              key={item.label}
              className="flex-row justify-between items-center py-4 px-4 border-b border-divider last:border-0"
            >
              <Text className="text-brand">{item.label}</Text>
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
