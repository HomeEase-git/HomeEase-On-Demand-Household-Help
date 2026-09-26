import React, { useState } from "react";
import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "../../components/ui/KeyboardAwareScrollView";
import ScreenHeader from "../../components/ui/ScreenHeader";
import InputField from "../../components/ui/InputField";
import PrimaryButton from "../../components/ui/PrimaryButton";
import { useAlertModal } from "../../contexts/AlertModalContext";
import { requestSuspensionReview } from "../../services/api";

// Reached from sign-in when the account is suspended or banned. The user
// can't log in, so they confirm it's their account with their password.
export default function RequestReviewScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(typeof params.email === "string" ? params.email : "");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const trimmedMessage = message.trim();
  const canSubmit =
    email.trim().length > 0 &&
    password.length > 0 &&
    trimmedMessage.length >= 10 &&
    trimmedMessage.length <= 1000;

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      await requestSuspensionReview(email.trim(), password, trimmedMessage);
      alertModal.success(
        "Request sent",
        "An admin will review your account. If it's reinstated, you'll be able to sign in again.",
        [{ text: "OK", onPress: () => router.back() }],
      );
    } catch (error: any) {
      alertModal.error(
        "Couldn't send your request",
        error?.message || "Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Request a Review" showBack />
      <KeyboardAwareScrollView contentContainerStyle={{ padding: 24 }}>
        <Text className="text-text-secondary text-sm mb-4">
          If you think your account was suspended by mistake, tell us what
          happened. A HomeEase admin will review your account; a person, not
          an automated system, makes this decision.
        </Text>
        <InputField
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <InputField
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="Your password"
          secureTextEntry
        />
        <InputField
          label="What should we know?"
          value={message}
          onChangeText={setMessage}
          placeholder="Explain why your account should be reinstated (at least 10 characters)"
          multiline
        />
        <View className="mt-6">
          <PrimaryButton
            label="Send Request"
            fullWidth
            disabled={!canSubmit || submitting}
            loading={submitting}
            onPress={handleSubmit}
          />
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}
