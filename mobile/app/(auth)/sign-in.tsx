import React, { useState, useRef } from "react";
import { View, Text, Pressable, TextInput, Image, Keyboard } from "react-native";
import { KeyboardAwareScrollView } from "../../components/ui/KeyboardAwareScrollView";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { InputField } from "../../components/ui/InputField";
import { PrimaryButton } from "../../components/ui/PrimaryButton";
import { OutlinedButton } from "../../components/ui/OutlinedButton";
import { useAuth } from "../../hooks/useAuth";
import { validateEmail } from "../../utils/validators";
import { useToastContext } from "../../contexts/ToastContext";

export default function SignInScreen() {
  const router = useRouter();
  const { login, completeMfaChallenge, loading, clearError } = useAuth();
  const toast = useToastContext();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");

  // Set once the backend responds with `mfaRequired: true` — while this is
  // set, the form below renders the code-entry step instead of email/password.
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  // Set when login is refused because the account is suspended/banned —
  // offers the way to ask for a human review.
  const [accountBlocked, setAccountBlocked] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaError, setMfaError] = useState("");
  const [verifyingMfa, setVerifyingMfa] = useState(false);

  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const handleEmailChange = (text: string) => {
    setEmail(text);
    if (text.trim()) {
      const validation = validateEmail(text);
      setEmailError(validation.error || "");
    } else {
      setEmailError("");
    }
  };

  const handlePasswordChange = (text: string) => {
    setPassword(text);
    setPasswordError("");
  };

  const routeAfterLogin = (data: { role?: string; kycStatus?: string } | undefined) => {
    toast.success("Signed in successfully");

    let destination:
      | "/(client)/home"
      | "/(worker)/home"
      | "/(kyc)/rejected"
      | "/(kyc)/pending"
      | "/(kyc)/landing" = "/(client)/home";
    if (data?.role === "worker") {
      const kycStatus = data?.kycStatus;
      if (kycStatus === "APPROVED") {
        destination = "/(worker)/home";
      } else if (kycStatus === "REJECTED") {
        destination = "/(kyc)/rejected";
      } else if (kycStatus === "SUBMITTED") {
        // Docs already submitted — waiting on the admin to review.
        destination = "/(kyc)/pending";
      } else {
        // Never submitted KYC docs yet.
        destination = "/(kyc)/landing";
      }
    }
    // The password (or MFA code) field is still focused (native keyboard +
    // IME connection attached) at this point — replacing the entire (auth)
    // navigator for (client)/(worker) while it holds focus caused a
    // reproducible Fabric crash (`addViewAt: ... View already has a
    // parent`, confirmed via adb logcat) where the still-mounting
    // ReactEditText raced the stack swap. Keyboard.dismiss() itself is
    // fire-and-forget on the native side, so a short delay before
    // navigating gives its view teardown a real frame to finish rather
    // than racing it — dismissing and replacing in the same tick wasn't
    // reliably enough on live-device retest.
    Keyboard.dismiss();
    setTimeout(() => router.replace(destination), 100);
  };

  const handleSignIn = async () => {
    // Validate email
    const emailValidation = validateEmail(email);
    if (!emailValidation.valid) {
      setEmailError(emailValidation.error || "");
      toast.error(emailValidation.error || "Invalid email");
      return;
    }

    // Validate password
    if (!password.trim()) {
      setPasswordError("Password is required");
      toast.error("Please enter your password");
      return;
    }

    try {
      clearError();
      setAccountBlocked(false);
      const result = await login(email, password);

      if (result.data && "mfaRequired" in result.data && result.data.mfaRequired) {
        setChallengeToken(result.data.challengeToken as string);
        return;
      }

      routeAfterLogin(result.data);
    } catch (err: any) {
      // The backend intentionally returns the same 401 for "no account with
      // this email" and "wrong password" (prevents attackers from using this
      // form to discover which emails are registered), so show one combined,
      // human message here rather than whatever reason it gives.
      if (err?.code === "ACCOUNT_SUSPENDED" || err?.code === "ACCOUNT_BANNED") {
        setAccountBlocked(true);
      }
      const errorMsg =
        err?.statusCode === 401
          ? "Incorrect Email or Password"
          : err?.message || "Something went wrong. Please try again.";
      setPasswordError(errorMsg);
      toast.error(errorMsg);
    }
  };

  const handleMfaSubmit = async () => {
    const trimmedCode = mfaCode.trim();
    if (!trimmedCode) {
      setMfaError("Enter the 6-digit code from your authenticator app, or a backup code.");
      return;
    }

    setVerifyingMfa(true);
    setMfaError("");
    try {
      const result = await completeMfaChallenge(challengeToken as string, trimmedCode);
      routeAfterLogin(result.data);
    } catch (err: any) {
      setMfaError(err?.message || "Invalid code");
    } finally {
      setVerifyingMfa(false);
    }
  };

  const backToLogin = () => {
    setChallengeToken(null);
    setMfaCode("");
    setMfaError("");
  };

  if (challengeToken) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <KeyboardAwareScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="items-center mt-8">
            <Image
              source={require("../../assets/images/logo/home_ease-logo.png")}
              style={{ width: 120, height: 120, resizeMode: "contain" }}
            />
          </View>

          <Text className="text-text-primary text-2xl font-bold mt-4">
            Verify it&apos;s you
          </Text>
          <Text className="text-text-secondary mb-6">
            Enter the 6-digit code from your authenticator app, or one of your backup codes.
          </Text>

          <InputField
            label="Authentication code"
            value={mfaCode}
            onChangeText={(text) => {
              setMfaCode(text);
              if (mfaError) setMfaError("");
            }}
            placeholder="123456 or XXXX-XXXX"
            autoCapitalize="characters"
            returnKeyType="done"
            onSubmitEditing={handleMfaSubmit}
            editable={!verifyingMfa}
            error={mfaError}
          />

          <PrimaryButton
            label="Verify"
            fullWidth
            onPress={handleMfaSubmit}
            loading={verifyingMfa}
          />

          <View className="mt-3">
            <OutlinedButton label="Back to login" onPress={backToLogin} disabled={verifyingMfa} />
          </View>
        </KeyboardAwareScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAwareScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="items-center mt-8">
          <Image
            source={require("../../assets/images/logo/home_ease-logo.png")}
            style={{ width: 120, height: 120, resizeMode: "contain" }}
          />
        </View>

        <Text className="text-text-primary text-2xl font-bold mt-4">
          Welcome Back
        </Text>
        <Text className="text-text-secondary mb-6">Sign in to continue</Text>

        <InputField
          ref={emailRef}
          label="Email"
          value={email}
          onChangeText={handleEmailChange}
          placeholder="Enter your email"
          keyboardType="email-address"
          autoCapitalize="none"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          editable={!loading}
          error={emailError}
        />

        <InputField
          ref={passwordRef}
          label="Password"
          value={password}
          onChangeText={handlePasswordChange}
          placeholder="Enter your password"
          secureTextEntry
          returnKeyType="done"
          onSubmitEditing={handleSignIn}
          editable={!loading}
          error={passwordError}
        />

        <Pressable
          className="self-end mb-6"
          disabled={loading}
          onPress={() => router.push("/(auth)/forgot-password")}
        >
          <Text className="text-accent font-semibold">Forgot Password?</Text>
        </Pressable>

        <PrimaryButton
          label="Sign In"
          fullWidth
          onPress={handleSignIn}
          loading={loading}
        />

        {accountBlocked && (
          <View className="mt-3">
            <OutlinedButton
              label="Request a review"
              onPress={() =>
                router.push({ pathname: "/(auth)/request-review", params: { email } })
              }
            />
          </View>
        )}

        <View className="flex-row items-center my-6">
          <View className="flex-1 h-px bg-divider" />
          <Text className="text-text-muted px-3 text-sm">or</Text>
          <View className="flex-1 h-px bg-divider" />
        </View>

        <OutlinedButton
          label="Create an account"
          onPress={() => router.push("/role-selection")}
          disabled={loading}
        />
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}
