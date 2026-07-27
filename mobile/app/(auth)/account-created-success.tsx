import React, { useEffect } from "react";
import { View, Text, ScrollView, Animated, Easing } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import PrimaryButton from "../../components/ui/PrimaryButton";
import { colors } from "../../constants";

export default function AccountCreatedSuccessScreen() {
  const router = useRouter();
  const scaleAnim = React.useRef(new Animated.Value(0)).current;
  const rotateAnim = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Scale animation for the icon
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();

    // Continuous rotation for the icon
    Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 2000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ).start();
  }, [scaleAnim, rotateAnim]);

  const rotateDegrees = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const handleGetStarted = () => {
    router.replace("/(kyc)/landing");
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingVertical: 40,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Animated.View
          style={{
            transform: [{ scale: scaleAnim }],
            marginBottom: 32,
          }}
        >
          <View className="w-40 h-40 bg-success/20 rounded-full items-center justify-center">
            <Ionicons name="checkmark-circle" size={100} color={colors.success} />
          </View>
        </Animated.View>

        <Text className="text-text-primary text-3xl font-bold text-center mb-2">
          Account Created!
        </Text>

        <Text className="text-text-secondary text-center text-lg mb-8">
          Welcome to HomeEase! Your account is ready to use.
        </Text>

        <View className="w-full bg-green-50 p-4 rounded-lg mb-8">
          <View className="flex-row items-center mb-3">
            <Ionicons name="checkmark" size={20} color={colors.success} />
            <Text className="text-success font-semibold text-sm ml-3">
              Email verified
            </Text>
          </View>
          <View className="flex-row items-center mb-3">
            <Ionicons name="lock-closed" size={20} color={colors.success} />
            <Text className="text-success font-semibold text-sm ml-3">
              Account secured
            </Text>
          </View>
          <View className="flex-row items-center">
            <Ionicons name="person" size={20} color={colors.success} />
            <Text className="text-success font-semibold text-sm ml-3">
              Profile created
            </Text>
          </View>
        </View>

        <Text className="text-text-secondary text-center text-sm mb-12">
          Next, complete your profile and KYC verification to unlock all
          features.
        </Text>

        <PrimaryButton
          label="Get Started"
          fullWidth
          onPress={handleGetStarted}
        />

        <Text className="text-text-muted text-xs text-center mt-8">
          You can also complete your profile later from the settings menu.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
