import React, { useEffect } from "react";
import { View, Text, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

export default function SplashScreen() {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace("/landing");
    }, 2000);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <SafeAreaView className="flex-1 bg-white items-center justify-center">
      <View className="items-center">
        <View className="w-32 h-32 items-center justify-center">
          <Image
            source={require("../assets/images/logo/home_ease-logo.png")}
            style={{ width: 200, height: 200, resizeMode: "contain" }}
          />
        </View>
        {/* <Text className="text-text-primary text-3xl font-bold mt-6">HomeEase</Text>
        <Text className="text-text-secondary text-sm mt-1">
          On-Demand Household Help
        </Text> */}
      </View>
    </SafeAreaView>
  );
}
