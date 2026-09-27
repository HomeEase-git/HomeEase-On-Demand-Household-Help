import React, { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "../ui/KeyboardAwareScrollView";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import ScreenHeader from "../ui/ScreenHeader";
import InputField from "../ui/InputField";
import PrimaryButton from "../ui/PrimaryButton";
import DangerButton from "../ui/DangerButton";
import OutlinedButton from "../ui/OutlinedButton";
import { useAuthStore } from "../../store/authStore";
import { useAlertModal } from "../../contexts/AlertModalContext";
import { colors } from "../../constants";
import * as api from "../../services/api";

// Must match DELETE_CONFIRMATION_TEXT in the backend's userController.
const CONFIRMATION_TEXT = "DELETE MY ACCOUNT";

const REASONS = [
  "I don't use HomeEase anymore",
  "I found another service",
  "Privacy concerns",
  "Too many problems with bookings",
  "Other",
];

type Props = {
  /** Workers can take a break instead — shown as an alternative on step 1. */
  deactivatePath?: string;
};

/**
 * Deleting an account is deliberately slow: (1) read what's erased and pick
 * a reason, (2) get a code by email — the server refuses here while a
 * booking or payment is still open, (3) password + code + typing the
 * confirmation phrase in full.
 */
export default function DeleteAccountScreen({ deactivatePath }: Props) {
  const router = useRouter();
  const alertModal = useAlertModal();
  const logout = useAuthStore((s) => s.logout);

  const [step, setStep] = useState<1 | 2>(1);
  const [reason, setReason] = useState<string | null>(null);
  const [otherReason, setOtherReason] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fullReason = reason === "Other" ? otherReason.trim() : reason ?? "";
  const canDelete =
    /^\d{6}$/.test(code.trim()) && password.length > 0 && confirmText.trim().toUpperCase() === CONFIRMATION_TEXT;

  const requestCode = async () => {
    setSending(true);
    try {
      await api.requestAccountDeletionCode();
      setStep(2);
    } catch (error: any) {
      // 409 = something still open (a booking in progress, unpaid balance
      // or earnings not yet paid out); the server says what.
      alertModal.error("You can't delete your account yet", error?.message || "Please try again.");
    } finally {
      setSending(false);
    }
  };

  const handleDelete = () => {
    alertModal.confirm("Delete your account for good?", "This can't be undone.", {
      confirmText: "Delete",
      destructive: true,
      onConfirm: async () => {
        setDeleting(true);
        try {
          await api.deleteAccount({ password, code: code.trim(), confirmText: confirmText.trim(), reason: fullReason });
          await logout();
          alertModal.success("Account deleted", "Your account and personal data have been deleted.", [
            { text: "OK", onPress: () => router.replace("/landing") },
          ]);
        } catch (error: any) {
          alertModal.error("Couldn't delete your account", error?.message || "Please try again.");
        } finally {
          setDeleting(false);
        }
      },
    });
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Delete Account" showBack />
      <KeyboardAwareScrollView contentContainerStyle={{ padding: 24, paddingBottom: 48 }}>
        <View className="items-center mb-4">
          <View className="w-20 h-20 bg-error/10 rounded-full items-center justify-center">
            <Ionicons name="warning" size={40} color={colors.error} />
          </View>
        </View>
        <Text className="text-text-muted text-xs text-center mb-4">Step {step} of 2</Text>

        {step === 1 ? (
          <>
            <Text className="text-error text-2xl font-bold text-center mb-4">Delete Your Account?</Text>
            <View className="bg-error/10 border border-error rounded-xl p-4 mb-4">
              <Text className="text-error text-sm">
                Your profile, saved addresses, uploaded documents and photos, and payment details will be erased.
                This can&apos;t be undone.
              </Text>
            </View>
            <Text className="text-text-secondary text-sm mb-4">
              Booking, payment and tax records are kept as required by law, with your name removed. Chat messages
              stay visible to the people you talked to. You can&apos;t delete your account while a booking is in
              progress or a payment is still due.
            </Text>

            {deactivatePath && (
              <Pressable
                className="bg-accent/10 rounded-xl p-4 mb-4 flex-row items-center"
                onPress={() => router.push(deactivatePath as any)}
              >
                <Ionicons name="pause-circle-outline" size={22} color={colors.accent.DEFAULT} />
                <View className="flex-1 ml-3">
                  <Text className="text-text-primary font-semibold text-sm">Just need a break?</Text>
                  <Text className="text-text-secondary text-xs mt-0.5">
                    Deactivate instead — nothing is deleted and you can come back any time.
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.text.muted} />
              </Pressable>
            )}

            <Text className="text-text-primary font-semibold mb-2">Why are you leaving?</Text>
            {REASONS.map((r) => (
              <Pressable
                key={r}
                accessibilityRole="radio"
                accessibilityState={{ checked: reason === r }}
                onPress={() => setReason(r)}
                className="flex-row items-center py-2.5"
              >
                <Ionicons
                  name={reason === r ? "radio-button-on" : "radio-button-off"}
                  size={20}
                  color={reason === r ? colors.accent.DEFAULT : colors.text.muted}
                />
                <Text className="text-text-primary text-sm ml-3">{r}</Text>
              </Pressable>
            ))}
            {reason === "Other" && (
              <InputField label="Tell us more" value={otherReason} onChangeText={setOtherReason} multiline />
            )}

            <View className="gap-3 mt-6">
              <DangerButton
                label="Continue"
                fullWidth
                loading={sending}
                disabled={!reason || (reason === "Other" && !otherReason.trim()) || sending}
                onPress={requestCode}
              />
              <OutlinedButton label="Keep My Account" onPress={() => router.back()} />
            </View>
          </>
        ) : (
          <>
            <Text className="text-text-primary text-lg font-bold mb-2">Confirm it&apos;s you</Text>
            <Text className="text-text-secondary text-sm mb-4">
              We emailed you a 6-digit code. Enter it with your password, then type {CONFIRMATION_TEXT} to confirm.
            </Text>
            <InputField
              label="Code from your email"
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              keyboardType="number-pad"
            />
            <Pressable className="self-start mb-4" disabled={sending} onPress={requestCode}>
              <Text className="text-accent font-semibold text-sm">{sending ? "Sending..." : "Send a new code"}</Text>
            </Pressable>
            <InputField label="Password" value={password} onChangeText={setPassword} secureTextEntry />
            <InputField
              label={`Type ${CONFIRMATION_TEXT}`}
              value={confirmText}
              onChangeText={setConfirmText}
              placeholder={CONFIRMATION_TEXT}
              autoCapitalize="characters"
            />
            <View className="gap-3 mt-4">
              <DangerButton
                label="Delete My Account"
                fullWidth
                loading={deleting}
                disabled={!canDelete || deleting}
                onPress={handleDelete}
              />
              <PrimaryButton label="Keep My Account" fullWidth onPress={() => router.back()} />
            </View>
          </>
        )}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}
