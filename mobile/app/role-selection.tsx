import React from "react";
import { View, Text, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  ClientRoleIllustration,
  WorkerRoleIllustration,
} from "../components/illustrations/Illustrations";

type Role = "client" | "worker";

export default function RoleSelectionScreen() {
  const router = useRouter();

  const handleRoleSelect = (role: Role) => {
    router.push({ pathname: "/(auth)/sign-up", params: { role } });
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top", "bottom"]}>
      <View className="flex-1 px-6 pt-6 pb-6">
        <Text className="text-text-primary text-3xl font-bold text-center mb-6">
          Select Your Role
        </Text>

        <View className="flex-1">
          {/* Client Option */}
          <Pressable
            className="flex-1 bg-card-light border-2 border-brand rounded-2xl p-6 mb-3 items-center justify-center"
            onPress={() => handleRoleSelect("client")}
          >
            <View className="items-center mb-4">
              <ClientRoleIllustration size={160} />
            </View>
            <Text className="text-text-primary font-bold text-xl text-center">
              Client
            </Text>
            <Text className="text-text-secondary text-center mt-1">
              I need home services
            </Text>
          </Pressable>

          {/* Worker Option */}
          <Pressable
            className="flex-1 bg-card-light border-2 border-accent rounded-2xl p-6 mt-3 items-center justify-center"
            onPress={() => handleRoleSelect("worker")}
          >
            <View className="items-center mb-4">
              <WorkerRoleIllustration size={160} />
            </View>
            <Text className="text-accent font-bold text-xl text-center">
              Service Worker
            </Text>
            <Text className="text-text-secondary text-center mt-1">
              I offer home services
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
