import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, Image, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import InputField from "../../../components/ui/InputField";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../components/ui/OutlinedButton";
import * as api from "../../../services/api";
import { colors, cardShadow } from "../../../constants";
import { useAlertModal } from "../../../contexts/AlertModalContext";

// Opt-in MFA for client accounts — unlike the admin web panel, nothing here
// forces enrollment; this screen is only reachable by choice from Profile.
export default function TwoFactorAuthScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();

  const [loading, setLoading] = useState(true);
  const [mfaEnabled, setMfaEnabled] = useState(false);

  const [setupData, setSetupData] = useState<{
    provisioningUri: string;
    qrCodeDataUrl: string;
    secret: string;
  } | null>(null);
  const [confirmCode, setConfirmCode] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [disableError, setDisableError] = useState("");
  const [isDisabling, setIsDisabling] = useState(false);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const current = await api.fetchCurrentUser();
      setMfaEnabled(Boolean(current.mfaEnabled));
    } catch (error) {
      console.error("Load MFA status error:", error);
      alertModal.error("Error", "Unable to load your two-factor authentication status.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStartSetup = async () => {
    setIsStarting(true);
    try {
      const data = await api.startMfaSetup();
      setSetupData(data);
    } catch (error: any) {
      alertModal.error("Error", error?.message || "Failed to start MFA setup");
    } finally {
      setIsStarting(false);
    }
  };

  const handleConfirmSetup = async () => {
    const trimmed = confirmCode.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      setConfirmError("Enter the 6-digit code from your authenticator app.");
      return;
    }

    setIsConfirming(true);
    setConfirmError("");
    try {
      const result = await api.confirmMfaSetup(trimmed);
      setBackupCodes(result.backupCodes);
      setMfaEnabled(true);
    } catch (error: any) {
      setConfirmError(error?.message || "Invalid code");
    } finally {
      setIsConfirming(false);
    }
  };

  const handleDisable = async () => {
    if (!disablePassword || !disableCode.trim()) {
      setDisableError("Password and MFA code are required.");
      return;
    }

    setIsDisabling(true);
    setDisableError("");
    try {
      await api.disableMfa(disablePassword, disableCode.trim());
      setMfaEnabled(false);
      setSetupData(null);
      setBackupCodes(null);
      setDisablePassword("");
      setDisableCode("");
      alertModal.success("MFA disabled", "Two-factor authentication has been turned off.");
    } catch (error: any) {
      setDisableError(error?.message || "Failed to disable MFA");
    } finally {
      setIsDisabling(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Two-Factor Authentication" showBack />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.accent.DEFAULT} />
        </View>
      </SafeAreaView>
    );
  }

  // Backup codes are shown exactly once, right after a successful
  // verify-setup — nothing lets you retrieve them again after leaving this
  // screen.
  if (backupCodes) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Save Your Backup Codes" showBack={false} />
        <ScrollView contentContainerStyle={{ padding: 24 }}>
          <Text className="text-error text-sm mb-4">
            Save these backup codes now. Each one can be used once to sign in if you lose access
            to your authenticator app. They will not be shown again.
          </Text>
          <View className="flex-row flex-wrap justify-between mb-6">
            {backupCodes.map((code) => (
              <View
                key={code}
                className="bg-gray-100 border border-divider rounded-xl py-3 mb-2"
                style={{ width: "48%" }}
              >
                <Text className="text-text-primary text-center font-mono">{code}</Text>
              </View>
            ))}
          </View>
          <PrimaryButton
            label="I've saved these codes — continue"
            fullWidth
            onPress={() => router.back()}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!mfaEnabled) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Two-Factor Authentication" showBack />
        <ScrollView contentContainerStyle={{ padding: 24 }}>
          <View className="items-center mb-5">
            <View className="w-16 h-16 rounded-full bg-accent/10 items-center justify-center">
              <Ionicons name="shield-checkmark-outline" size={30} color={colors.accent.DEFAULT} />
            </View>
          </View>
          {!setupData ? (
            <>
              <Text className="text-text-secondary text-center mb-6">
                Add an extra layer of security to your account with an authenticator app (Google
                Authenticator, Authy, 1Password, etc.). This is optional.
              </Text>
              <PrimaryButton
                label={isStarting ? "Starting..." : "Start setup"}
                fullWidth
                onPress={handleStartSetup}
                loading={isStarting}
              />
            </>
          ) : (
            <>
              <Text className="text-text-secondary text-center mb-4">
                Scan this QR code with your authenticator app, then enter the 6-digit code it
                shows.
              </Text>
              <View className="items-center mb-4">
                <Image
                  source={{ uri: setupData.qrCodeDataUrl }}
                  style={{ width: 200, height: 200 }}
                />
              </View>
              <InputField
                label="Can't scan? Enter this key manually"
                value={setupData.secret}
                onChangeText={() => {}}
                editable={false}
              />
              <InputField
                label="6-digit code"
                value={confirmCode}
                onChangeText={(text) => {
                  setConfirmCode(text);
                  if (confirmError) setConfirmError("");
                }}
                placeholder="123456"
                keyboardType="number-pad"
                error={confirmError}
              />
              <PrimaryButton
                label={isConfirming ? "Confirming..." : "Confirm and enable MFA"}
                fullWidth
                onPress={handleConfirmSetup}
                loading={isConfirming}
              />
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Two-Factor Authentication" showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <View className="items-center mb-5">
          <View className="w-16 h-16 rounded-full bg-success/10 items-center justify-center">
            <Ionicons name="shield-checkmark" size={30} color={colors.success} />
          </View>
        </View>
        <Text className="text-text-primary text-center font-semibold mb-1">
          Enabled on this account
        </Text>
        <View
          className="bg-card rounded-2xl p-4 mt-4"
          style={cardShadow}
        >
          <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide mb-3">
            Disable MFA
          </Text>
          <Text className="text-text-secondary text-sm mb-4">
            Requires your current password and a valid authenticator/backup code.
          </Text>
          <InputField
            label="Current password"
            value={disablePassword}
            onChangeText={setDisablePassword}
            secureTextEntry
          />
          <InputField
            label="Authentication code"
            value={disableCode}
            onChangeText={setDisableCode}
            placeholder="123456 or XXXX-XXXX"
          />
          {disableError ? (
            <Text className="text-error text-sm mb-3">{disableError}</Text>
          ) : null}
          <OutlinedButton
            label={isDisabling ? "Disabling..." : "Disable MFA"}
            fullWidth
            onPress={handleDisable}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
