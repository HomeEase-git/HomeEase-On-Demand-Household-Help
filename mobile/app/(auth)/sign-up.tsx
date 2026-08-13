import React, { useState, useRef } from "react";
import { View, Text, ScrollView, Pressable, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { InputField } from "../../components/ui/InputField";
import { PrimaryButton } from "../../components/ui/PrimaryButton";
import { useAuth } from "../../hooks/useAuth";
import {
  validateEmail,
  validatePassword,
  validateName,
  validatePhone,
  validatePasswordMatch,
} from "../../utils/validators";
import { useToastContext } from "../../contexts/ToastContext";

export default function SignUpScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ role?: string }>();
  const role = (params.role as string) || "client";
  const { signup, loading, clearError } = useAuth();
  const toast = useToastContext();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [nameError, setNameError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [confirmPasswordError, setConfirmPasswordError] = useState("");

  const fullNameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);

  const handleNameChange = (text: string) => {
    setFullName(text);
    if (text.trim()) {
      const validation = validateName(text);
      setNameError(validation.error || "");
    } else {
      setNameError("");
    }
  };

  const handleEmailChange = (text: string) => {
    setEmail(text);
    if (text.trim()) {
      const validation = validateEmail(text);
      setEmailError(validation.error || "");
    } else {
      setEmailError("");
    }
  };

  const handlePhoneChange = (text: string) => {
    setPhone(text);
    if (text.trim()) {
      const validation = validatePhone(text);
      setPhoneError(validation.error || "");
    } else {
      setPhoneError("");
    }
  };

  const handlePasswordChange = (text: string) => {
    setPassword(text);
    if (text) {
      const validation = validatePassword(text);
      setPasswordError(validation.error || "");
    } else {
      setPasswordError("");
    }
  };

  const handleConfirmPasswordChange = (text: string) => {
    setConfirmPassword(text);
    if (text && password) {
      const validation = validatePasswordMatch(password, text);
      setConfirmPasswordError(validation.error || "");
    } else {
      setConfirmPasswordError("");
    }
  };

  const handleSignUp = async () => {
    const nameValidation = validateName(fullName);
    const emailValidation = validateEmail(email);
    const phoneValidation = validatePhone(phone);
    const passwordValidation = validatePassword(password);
    const confirmPasswordValidation = validatePasswordMatch(
      password,
      confirmPassword,
    );

    setNameError(nameValidation.error || "");
    setEmailError(emailValidation.error || "");
    setPhoneError(phoneValidation.error || "");
    setPasswordError(passwordValidation.error || "");
    setConfirmPasswordError(confirmPasswordValidation.error || "");

    if (
      !nameValidation.valid ||
      !emailValidation.valid ||
      !phoneValidation.valid ||
      !passwordValidation.valid ||
      !confirmPasswordValidation.valid
    ) {
      toast.error("Please fix all errors before continuing");
      return;
    }

    if (!acceptedTerms) {
      toast.warning("Please accept the Terms and Conditions");
      return;
    }

    try {
      clearError();
      await signup({
        fullName,
        email,
        phone,
        password,
        role: role as "client" | "worker",
      });

      toast.success("Account created successfully");

      router.push({
        pathname: "/(auth)/otp-verification",
        params: { email, role },
      });
    } catch (err: any) {
      const errorMsg = err?.message || "Something went wrong. Please try again.";
      toast.error(errorMsg);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="pt-4 pb-2">
          <Text className="text-text-primary text-2xl font-bold">
            Create Account
          </Text>
          <Text className="text-text-secondary mt-1">
            {role === "worker"
              ? "Join as a Service Provider"
              : "Join as a Client"}
          </Text>
        </View>

        {/* Full Name */}
        <InputField
          ref={fullNameRef}
          label="Full Name"
          value={fullName}
          onChangeText={handleNameChange}
          placeholder="Enter your full name"
          returnKeyType="next"
          onSubmitEditing={() => emailRef.current?.focus()}
          editable={!loading}
          error={nameError}
        />

        {/* Email */}
        <InputField
          ref={emailRef}
          label="Email"
          value={email}
          onChangeText={handleEmailChange}
          placeholder="Enter your email"
          keyboardType="email-address"
          autoCapitalize="none"
          returnKeyType="next"
          onSubmitEditing={() => phoneRef.current?.focus()}
          editable={!loading}
          error={emailError}
        />

        {/* Phone */}
        <InputField
          ref={phoneRef}
          label="Phone"
          value={phone}
          onChangeText={handlePhoneChange}
          placeholder="Enter your phone number"
          keyboardType="phone-pad"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          editable={!loading}
          error={phoneError}
        />

        {/* Password */}
        <InputField
          ref={passwordRef}
          label="Password"
          value={password}
          onChangeText={handlePasswordChange}
          placeholder="Create a password"
          secureTextEntry={!showPassword}
          returnKeyType="next"
          onSubmitEditing={() => confirmPasswordRef.current?.focus()}
          editable={!loading}
          error={passwordError}
        />

        {/* Confirm Password */}
        <InputField
          ref={confirmPasswordRef}
          label="Confirm Password"
          value={confirmPassword}
          onChangeText={handleConfirmPasswordChange}
          placeholder="Confirm your password"
          secureTextEntry={!showConfirmPassword}
          returnKeyType="done"
          onSubmitEditing={handleSignUp}
          editable={!loading}
          error={confirmPasswordError}
        />

        {/* Terms Checkbox */}
        <Pressable
          className="flex-row items-center mb-6"
          onPress={() => setAcceptedTerms(!acceptedTerms)}
          disabled={loading}
        >
          <View
            className={`w-5 h-5 rounded border-2 mr-2 items-center justify-center ${
              acceptedTerms ? "bg-accent border-accent" : "border-divider"
            }`}
          >
            {acceptedTerms && (
              <Text className="text-text-primary text-xs font-bold">✓</Text>
            )}
          </View>
          <Text className="text-text-secondary text-sm flex-1">
            I agree to the{" "}
            <Text
              className="text-accent underline"
              onPress={() => router.push("/(auth)/terms-conditions")}
            >
              Terms and Conditions
            </Text>
          </Text>
        </Pressable>

        <PrimaryButton
          label="Sign Up"
          fullWidth
          onPress={handleSignUp}
          loading={loading}
        />

        <Pressable
          className="mt-6 flex-row justify-center"
          disabled={loading}
          onPress={() => router.replace("/(auth)/sign-in")}
        >
          <Text className="text-text-secondary">Already have an account? </Text>
          <Text className="text-accent font-semibold">Sign In</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
