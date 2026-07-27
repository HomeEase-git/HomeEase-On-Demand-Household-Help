import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, Switch, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import { useAuthStore } from "../../../store/authStore";
import * as api from "../../../services/api";
import { colors } from "../../../constants/colors";

const DAYS = [
  { key: "Mon", label: "Monday" },
  { key: "Tue", label: "Tuesday" },
  { key: "Wed", label: "Wednesday" },
  { key: "Thu", label: "Thursday" },
  { key: "Fri", label: "Friday" },
  { key: "Sat", label: "Saturday" },
  { key: "Sun", label: "Sunday" },
];

const TODAY_KEY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
  new Date().getDay()
];

export default function AvailabilityScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [schedule, setSchedule] = useState<Record<string, boolean>>(
    Object.fromEntries(DAYS.map(({ key }, i) => [key, i < 5])),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!user?.id) return;
      setLoading(true);
      try {
        const detail = await api.getWorkerDetail(user.id);
        if (!active || !detail) return;
        if (detail.availableDays.length > 0) {
          setSchedule(
            Object.fromEntries(
              DAYS.map(({ key }) => [key, detail.availableDays.includes(key)]),
            ),
          );
        }
      } catch (error) {
        console.error("Load availability error:", error);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [user?.id]);

  const toggleDay = (key: string) => {
    setSchedule((s) => ({ ...s, [key]: !s[key] }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const availableDays = DAYS.filter(({ key }) => schedule[key]).map(({ key }) => key);
      // Only update the weekly schedule here — the global on/off toggle lives on the Home screen.
      await api.updateAvailability(undefined, availableDays);
      Alert.alert("Saved");
      router.back();
    } catch (error) {
      console.error("Save availability error:", error);
      Alert.alert("Error", "Failed to save your schedule.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
        <ScreenHeader title="Set Availability" showBack />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="small" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader title="Set Availability" showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        {/* Section label */}
        <Text
          style={{
            color: colors.brand.DEFAULT,
            fontWeight: "700",
            fontSize: 16,
            marginBottom: 4,
          }}
        >
          Working days
        </Text>
        <Text
          style={{ color: colors.text.muted, fontSize: 13, marginBottom: 16 }}
        >
          Toggle the days you&apos;re available for bookings
        </Text>

        {/* Day rows */}
        <View
          style={{
            backgroundColor: colors.card.DEFAULT,
            borderRadius: 16,
            marginBottom: 16,
            overflow: "hidden",
            borderWidth: 1,
            borderColor: colors.divider,
          }}
        >
          {DAYS.map(({ key, label }, index) => {
            const isOn = schedule[key] ?? false;
            const isToday = key === TODAY_KEY;
            const isLast = index === DAYS.length - 1;

            return (
              <View
                key={key}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  borderBottomWidth: isLast ? 0 : 1,
                  borderBottomColor: colors.divider,
                  backgroundColor: isOn
                    ? colors.card.DEFAULT
                    : colors.card.light,
                }}
              >
                {/* Left: day name + badges */}
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                >
                  <Text
                    style={{
                      color: colors.text.primary,
                      fontSize: 14,
                      fontWeight: "500",
                    }}
                  >
                    {label}
                  </Text>
                  {isToday && (
                    <View
                      style={{
                        backgroundColor: colors.accent.muted + "22",
                        borderRadius: 99,
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                      }}
                    >
                      <Text
                        style={{
                          color: colors.accent.DEFAULT,
                          fontSize: 11,
                          fontWeight: "600",
                        }}
                      >
                        Today
                      </Text>
                    </View>
                  )}
                  {!isOn && (
                    <View
                      style={{
                        backgroundColor: colors.card.dark,
                        borderRadius: 99,
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                      }}
                    >
                      <Text style={{ color: colors.text.muted, fontSize: 11 }}>
                        Day off
                      </Text>
                    </View>
                  )}
                </View>

                {/* Right: toggle */}
                <Switch
                  value={isOn}
                  onValueChange={() => toggleDay(key)}
                  trackColor={{
                    false: colors.divider,
                    true: colors.brand.DEFAULT,
                  }}
                  thumbColor={colors.white}
                />
              </View>
            );
          })}
        </View>

        {/* Footer note */}
        <Text
          style={{
            color: colors.text.muted,
            fontSize: 12,
            textAlign: "center",
            marginBottom: 24,
          }}
        >
          Changes apply to all future bookings
        </Text>

        <PrimaryButton
          label="Save Schedule"
          fullWidth
          onPress={handleSave}
          disabled={saving}
          loading={saving}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
