import React from "react";
import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import { useRouter } from "expo-router";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import { colors } from "../../../../constants";

export default function PaymentFailedScreen() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-white items-center justify-center px-8">
      <View className="w-32 h-32 bg-error/20 rounded-full items-center justify-center mb-8">
        <Ionicons name="close-circle" size={80} color={colors.error} />
      </View>
      <Text className="text-error text-2xl font-bold text-center">
        Payment Failed
      </Text>
      <View className="bg-error/10 border border-error rounded-xl p-4 w-full mt-6">
        <Text className="text-error text-sm">Error code: PAYMENT_DECLINED</Text>
        <Text className="text-text-secondary text-sm mt-1">
          Your payment could not be processed. Please try again.
        </Text>
      </View>
      <View className="w-full mt-8 gap-3">
        <PrimaryButton
          label="Try Again"
          fullWidth
          onPress={() => router.back()}
        />
        <OutlinedButton
          label="Pay with Cash"
          onPress={() => router.replace("/(client)/booking/payment/success")}
        />
      </View>
    </SafeAreaView>
  );
}
