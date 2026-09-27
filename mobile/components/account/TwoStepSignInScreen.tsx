import React, { useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenSkeleton } from "../feedback/ScreenSkeleton";
import { KeyboardAwareScrollView } from "../ui/KeyboardAwareScrollView";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import ScreenHeader from "../ui/ScreenHeader";
import InputField from "../ui/InputField";
import PrimaryButton from "../ui/PrimaryButton";
import OutlinedButton from "../ui/OutlinedButton";
import * as api from "../../services/api";
import type { TwoFactorMethod } from "../../services/api";
import { colors, cardShadow } from "../../constants";
import { useAlertModal } from "../../contexts/AlertModalContext";

const METHODS: { value: TwoFactorMethod; label: string; icon: string; hint: string }[] = [
  { value: "EMAIL", label: "Email", icon: "mail-outline", hint: "We email a code to your sign-in address" },
  { value: "SMS", label: "Text message", icon: "chatbubble-outline", hint: "We text a code to your mobile number" },
];

/**
 * Optional two-step sign-in for clients and workers: after the password, a
 * 6-digit code is sent by email or SMS. (Admins use an authenticator app on
 * the web panel.) Older accounts that set up an authenticator app before can
 * still turn it off here.
 */
export default function TwoStepSignInScreen() {
  const alertModal = useAlertModal();

  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState<string | null>(null);
  const [method, setMethod] = useState<TwoFactorMethod | null>(null);
  const [legacyAuthenticator, setLegacyAuthenticator] = useState(false);

  // Turning on (or switching): the chosen channel, then the code sent to it.
  const [choice, setChoice] = useState<TwoFactorMethod>("EMAIL");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // "off" = turning it off (password + code sent to the current channel).
  const [mode, setMode] = useState<"idle" | "on" | "off">("idle");

  useEffect(() => {
    let cancelled = false;
    api
      .fetchCurrentUser()
      .then((current) => {
        if (cancelled) return;
        setPhone(current.phone);
        setMethod(current.twoFactorMethod);
        setLegacyAuthenticator(Boolean(current.mfaEnabled));
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Load two-step status error:", err);
        alertModal.error("Error", "Unable to load your two-step sign-in settings.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reset = () => {
    setMode("idle");
    setSentTo(null);
    setCode("");
    setPassword("");
    setError("");
  };

  const sendCode = async (target?: TwoFactorMethod) => {
    setBusy(true);
    setError("");
    try {
      const sent = await api.sendTwoFactorCode(target);
      setSentTo(sent.destination);
    } catch (err: any) {
      setError(err?.message || "Couldn't send the code. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleEnable = async () => {
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code we sent you.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api.enableTwoFactor(choice, code.trim());
      setMethod(result.twoFactorMethod);
      reset();
      alertModal.success(
        "Two-step sign-in is on",
        `Each time you sign in, we'll ${choice === "SMS" ? "text" : "email"} you a code.`,
      );
    } catch (err: any) {
      setError(err?.message || "That code is wrong or has expired.");
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    if (!password || !code.trim()) {
      setError("Enter your password and the code we sent you.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (legacyAuthenticator && !method) {
        await api.disableMfa(password, code.trim());
        setLegacyAuthenticator(false);
      } else {
        await api.disableTwoFactor(password, code.trim());
        setMethod(null);
      }
      reset();
      alertModal.success("Two-step sign-in is off", "You'll sign in with just your password.");
    } catch (err: any) {
      setError(err?.message || "Couldn't turn it off. Check your password and code.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Two-Step Sign-In" showBack />
        <ScreenSkeleton />
      </SafeAreaView>
    );
  }

  const isOn = Boolean(method);
  const errorText = error ? <Text className="text-error text-sm mb-3">{error}</Text> : null;

  // An authenticator app from before — the only thing left to do is turn it off.
  if (legacyAuthenticator && !isOn) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Two-Step Sign-In" showBack />
        <KeyboardAwareScrollView contentContainerStyle={{ padding: 24 }}>
          <Text className="text-text-secondary text-sm mb-4">
            You sign in with an authenticator app. To switch to email or text codes, turn it off first.
          </Text>
          <View className="bg-card rounded-2xl p-4" style={cardShadow}>
            <InputField label="Current password" value={password} onChangeText={setPassword} secureTextEntry />
            <InputField
              label="Authenticator code"
              value={code}
              onChangeText={setCode}
              placeholder="123456 or XXXX-XXXX"
            />
            {errorText}
            <OutlinedButton label={busy ? "Turning off..." : "Turn Off Authenticator App"} onPress={handleDisable} />
          </View>
        </KeyboardAwareScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Two-Step Sign-In" showBack />
      <KeyboardAwareScrollView contentContainerStyle={{ padding: 24 }}>
        <View className="items-center mb-5">
          <View
            className={`w-16 h-16 rounded-full items-center justify-center ${isOn ? "bg-success/10" : "bg-accent/10"}`}
          >
            <Ionicons
              name={isOn ? "shield-checkmark" : "shield-checkmark-outline"}
              size={30}
              color={isOn ? colors.success : colors.accent.DEFAULT}
            />
          </View>
        </View>
        <Text className="text-text-primary text-center font-semibold mb-1">
          {isOn ? `On — codes by ${method === "SMS" ? "text message" : "email"}` : "Off"}
        </Text>
        <Text className="text-text-secondary text-center text-sm mb-6">
          {isOn
            ? "After your password, you enter a 6-digit code we send you."
            : "Optional: add a 6-digit code, sent by email or text, after your password when you sign in."}
        </Text>

        {mode === "idle" && (
          <View className="gap-3">
            <PrimaryButton
              label={isOn ? "Change How I Get Codes" : "Turn On"}
              fullWidth
              onPress={() => {
                setChoice(method === "EMAIL" ? "SMS" : "EMAIL");
                setMode("on");
              }}
            />
            {isOn && (
              <OutlinedButton
                label="Turn Off"
                onPress={() => {
                  setMode("off");
                  sendCode();
                }}
              />
            )}
          </View>
        )}

        {mode === "on" && (
          <View className="bg-card rounded-2xl p-4" style={cardShadow}>
            {!sentTo ? (
              <>
                <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide mb-3">
                  Send codes by
                </Text>
                {METHODS.map((m) => {
                  const unavailable = m.value === "SMS" && !phone;
                  const selected = choice === m.value;
                  return (
                    <Pressable
                      key={m.value}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected, disabled: unavailable }}
                      disabled={unavailable}
                      onPress={() => setChoice(m.value)}
                      className={`flex-row items-center rounded-xl border p-3 mb-2 ${
                        selected ? "border-accent bg-accent/5" : "border-divider"
                      } ${unavailable ? "opacity-50" : ""}`}
                    >
                      <Ionicons name={m.icon as any} size={20} color={colors.accent.DEFAULT} />
                      <View className="flex-1 ml-3">
                        <Text className="text-text-primary font-semibold text-sm">{m.label}</Text>
                        <Text className="text-text-muted text-xs">
                          {unavailable ? "Add a mobile number in Edit Profile first" : m.hint}
                        </Text>
                      </View>
                      <Ionicons
                        name={selected ? "radio-button-on" : "radio-button-off"}
                        size={20}
                        color={selected ? colors.accent.DEFAULT : colors.text.muted}
                      />
                    </Pressable>
                  );
                })}
                {errorText}
                <View className="gap-3 mt-2">
                  <PrimaryButton label="Send Code" fullWidth loading={busy} onPress={() => sendCode(choice)} />
                  <OutlinedButton label="Cancel" onPress={reset} />
                </View>
              </>
            ) : (
              <>
                <Text className="text-text-secondary text-sm mb-3">
                  Enter the code we sent to {sentTo} to confirm it reaches you.
                </Text>
                <InputField
                  label="6-digit code"
                  value={code}
                  onChangeText={(t) => {
                    setCode(t);
                    if (error) setError("");
                  }}
                  placeholder="123456"
                  keyboardType="number-pad"
                />
                {errorText}
                <View className="gap-3">
                  <PrimaryButton label="Confirm" fullWidth loading={busy} onPress={handleEnable} />
                  <Pressable className="self-center py-1" disabled={busy} onPress={() => sendCode(choice)}>
                    <Text className="text-accent font-semibold">Send a new code</Text>
                  </Pressable>
                  <OutlinedButton label="Cancel" onPress={reset} />
                </View>
              </>
            )}
          </View>
        )}

        {mode === "off" && (
          <View className="bg-card rounded-2xl p-4" style={cardShadow}>
            <Text className="text-text-secondary text-sm mb-3">
              {sentTo ? `We sent a code to ${sentTo}.` : "Sending you a code..."} Enter it with your password to
              turn two-step sign-in off.
            </Text>
            <InputField label="Current password" value={password} onChangeText={setPassword} secureTextEntry />
            <InputField
              label="6-digit code"
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              keyboardType="number-pad"
            />
            {errorText}
            <View className="gap-3">
              <PrimaryButton label="Turn Off" fullWidth loading={busy} onPress={handleDisable} />
              <OutlinedButton label="Cancel" onPress={reset} />
            </View>
          </View>
        )}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}
