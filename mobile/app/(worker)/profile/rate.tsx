import React, { useEffect, useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import GenericConfirmationModal from "../../../components/modals/GenericConfirmationModal";
import { Skeleton } from "../../../components/ui/Skeleton";
import HourlyRateSlider from "../../../components/booking4step/HourlyRateSlider";
import { useAuthStore } from "../../../store/authStore";
import * as api from "../../../services/api";
import { colors } from "../../../constants/colors";
import { useAlertModal } from "../../../contexts/AlertModalContext";

const DEFAULT_RATE = 35;

export default function HourlyRateScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const user = useAuthStore((s) => s.user);
  const [rate, setRate] = useState(DEFAULT_RATE);
  const [originalRate, setOriginalRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!user?.id) return;
      setLoading(true);
      try {
        const detail = await api.getWorkerDetail(user.id);
        if (!active || !detail) return;
        const current = detail.hourlyRate ?? DEFAULT_RATE;
        setRate(current);
        setOriginalRate(detail.hourlyRate ?? null);
      } catch (error) {
        console.error("Load hourly rate error:", error);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [user?.id]);

  const handleSave = () => setConfirmVisible(true);

  const handleConfirm = async () => {
    setConfirmVisible(false);
    setSaving(true);
    try {
      await api.updateHourlyRate(rate);
      alertModal.success("Rate updated", `Your hourly rate is now ₱${rate}/hr.`);
      router.back();
    } catch (error) {
      console.error("Update hourly rate error:", error);
      const message = error instanceof Error ? error.message : "Failed to update your rate.";
      alertModal.error("Couldn't save", message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
        <ScreenHeader title="Hourly Rate" showBack />
        <ScrollView contentContainerStyle={{ padding: 24 }}>
          <Skeleton width="100%" height={140} borderRadius={16} marginBottom={16} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader title="Hourly Rate" showBack />
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 48 }}>
        <Text className="text-text-primary font-bold text-lg mb-1">Set your hourly rate</Text>
        <Text className="text-text-secondary text-sm mb-6">
          Shown to clients in search results and used to calculate their estimated total. Platform allows ₱20-₱100/hr.
        </Text>

        <View className="bg-card rounded-2xl p-5">
          <HourlyRateSlider value={rate} onChange={setRate} />
        </View>

        {originalRate != null && rate !== originalRate && (
          <Text className="text-text-muted text-xs text-center mt-3">
            Current rate: ₱{originalRate}/hr
          </Text>
        )}

        <View className="mt-8">
          <PrimaryButton
            label="Save Rate"
            fullWidth
            onPress={handleSave}
            disabled={saving || rate === originalRate}
            loading={saving}
          />
        </View>
      </ScrollView>

      <GenericConfirmationModal
        visible={confirmVisible}
        title="Update hourly rate?"
        message={`Your rate will change to ₱${rate}/hr. This applies to all future bookings — jobs already booked keep their original price.`}
        confirmLabel="Confirm"
        cancelLabel="Cancel"
        onConfirm={handleConfirm}
        onCancel={() => setConfirmVisible(false)}
      />
    </SafeAreaView>
  );
}
