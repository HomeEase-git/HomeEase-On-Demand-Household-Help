import React, { useEffect } from "react";
import { View, Image } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuthStore } from "../store/authStore";

const MIN_SPLASH_MS = 1200;

export default function SplashScreen() {
  const router = useRouter();
  const isInitializing = useAuthStore((s) => s.isInitializing);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (isInitializing) return;

    const timer = setTimeout(() => {
      if (isAuthenticated && user) {
        router.replace(user.role === "worker" ? "/(worker)/home" : "/(client)/home");
      } else {
        router.replace("/landing");
      }
    }, MIN_SPLASH_MS);
    return () => clearTimeout(timer);
  }, [router, isInitializing, isAuthenticated, user]);

  return (
    <SafeAreaView className="flex-1 bg-white items-center justify-center">
      <View className="items-center">
        <View className="w-32 h-32 items-center justify-center">
          <Image
            source={require("../assets/images/logo/home_ease-logo.png")}
            style={{ width: 200, height: 200, resizeMode: "contain" }}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}
