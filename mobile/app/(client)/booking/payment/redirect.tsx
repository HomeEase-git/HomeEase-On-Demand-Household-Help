import React, { useEffect } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors } from "../../../../constants";

export default function PaymentRedirectScreen() {
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => {
      router.replace("/(client)/booking/payment/success");
    }, 2000);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <SafeAreaView className="flex-1 bg-white items-center justify-center px-8">
      <View className="w-20 h-20 bg-green-500 rounded-full items-center justify-center mb-6">
        <Text className="text-text-primary font-bold text-2xl">G</Text>
      </View>
      <Text className="text-text-primary text-xl font-bold text-center">
        Redirecting to GCash...
      </Text>
      <Text className="text-text-secondary text-center mt-2">
        Please do not close this screen.
      </Text>
      <ActivityIndicator
        size="large"
        color={colors.accent.DEFAULT}
        style={{ marginTop: 24 }}
      />
    </SafeAreaView>
  );
}
