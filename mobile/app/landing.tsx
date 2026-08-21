import React from "react";
import { View, Text, ScrollView, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import PrimaryButton from "../components/ui/PrimaryButton";
import OutlinedButton from "../components/ui/OutlinedButton";

export default function LandingScreen() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "space-between",
          paddingVertical: 40,
        }}
      >
        <View className="px-4">
          <View className="w-full h-64 bg-white border border-card items-center justify-center rounded-3xl">
            <Image
              source={require("../assets/images/logo/home_ease-logo.png")}
              style={{ width: 200, height: 200, resizeMode: "contain" }}
            />
          </View>
        </View>

        <View className="px-6 mt-8">
          <Text className="text-text-primary text-3xl font-bold text-center">
            Your Home, Our Care
          </Text>
          <Text className="text-text-secondary text-center mt-3">
            Book trusted home service workers in minutes.
          </Text>
        </View>

        <View className="px-6 mt-10 gap-4">
          <PrimaryButton
            label="Get Started"
            fullWidth
            onPress={() => router.push("/(onboarding)")}
          />
          <OutlinedButton
            label="I already have an account"
            onPress={() => router.push("/(auth)/sign-in")}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
