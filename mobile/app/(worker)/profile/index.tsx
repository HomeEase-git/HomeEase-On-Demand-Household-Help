import React, { useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import StarRating from "../../../components/ui/StarRating";
import LogoutConfirmationModal from "../../../components/modals/LogoutConfirmationModal";
import { useAuthStore } from "../../../store/authStore";
import { colors } from "../../../constants";

const MENU = [
  { label: "Edit Profile", path: "/(worker)/profile/edit" },
  { label: "Digital ID", path: "/(worker)/profile/digital-id" },
  { label: "My Skills & Services", path: "/(worker)/profile/skills" },
  { label: "Set Availability", path: "/(worker)/profile/availability" },
  { label: "My Certifications", path: "/(worker)/profile/certifications" },
  { label: "My Reviews", path: "/(worker)/profile/reviews" },
  { label: "Resume Analysis (AI)", path: "/(worker)/profile/resume-preview" },
  { label: "Payout Method", path: "/(worker)/earnings/payout" },
  { label: "Change Password", path: "/(worker)/profile/change-password" },
  {
    label: "Notification Preferences",
    path: "/(worker)/profile/notification-preferences",
  },
  { label: "Privacy Settings", path: "/(worker)/profile/privacy-settings" },
  { label: "Help & Support", path: "/(worker)/profile/help-support" },
  { label: "Terms and Conditions", path: "/(worker)/profile/terms" },
  { label: "Privacy Policy", path: "/(worker)/profile/privacy-policy" },
  { label: "About HomeEase", path: "/(worker)/profile/about" },
];

export default function WorkerProfileScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [logoutVisible, setLogoutVisible] = useState(false);

  const displayName = user?.name ?? "Worker";
  const displayEmail = user?.email ?? "—";
  const displayPhone = user?.phone ?? "—";

  return (
    <SafeAreaView className="flex-1 bg-primary-white">
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View className="bg-card rounded-2xl p-5 mx-4 mt-4 flex-row items-center">
          <View className="w-16 h-16 bg-accent rounded-full items-center justify-center mr-3">
            <Ionicons name="person" size={32} color={colors.white} />
          </View>
          <View className="flex-1">
            <View className="flex-row items-center">
              <Text className="text-primary font-bold text-lg">
                {displayName}
              </Text>
              <View className="ml-1">
                <Ionicons
                  name="checkmark-circle"
                  size={18}
                  color={colors.success}
                />
              </View>
            </View>
            <Text className="text-text-secondary text-xs">
              Verified Professional
            </Text>
            <View className="flex-row items-center mt-1">
              <StarRating rating={4.8} size={14} />
              <Text className="text-text-muted text-xs ml-2">
                156 jobs completed
              </Text>
            </View>
          </View>
        </View>

        <View className="bg-card rounded-2xl p-4 mx-4 mt-3">
          <Text className="text-primary font-bold mb-2">
            Skills and Expertise
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {["Pipe Repair", "Installation", "Plumbing"].map((s) => (
              <View key={s} className="bg-accent/80 rounded-full px-3 py-1">
                <Text className="text-primary text-sm">{s}</Text>
              </View>
            ))}
          </View>
        </View>

        <View className="bg-primary-white rounded-2xl p-4 mx-4 mt-3">
          <Text className="text-primary font-bold mb-2">Contact</Text>
          <View className="bg-card-light rounded-xl p-3 mb-2 flex-row items-center">
            <Ionicons
              name="call-outline"
              size={16}
              color={colors.primary.DEFAULT}
            />
            <Text className="text-primary ml-2">{displayPhone}</Text>
            <Text className="text-text-secondary text-xs ml-2">
              Phone Number
            </Text>
          </View>
          <View className="bg-card-light rounded-xl p-3 flex-row items-center">
            <Ionicons
              name="mail-outline"
              size={16}
              color={colors.primary.DEFAULT}
            />
            <Text className="text-primary ml-2 flex-1" numberOfLines={1}>
              {displayEmail}
            </Text>
            <Text className="text-text-secondary text-xs ml-2">E-mail</Text>
          </View>
        </View>

        <View className="bg-card rounded-2xl mx-4 mt-3 overflow-hidden">
          {MENU.map((item) => (
            <Pressable
              key={item.label}
              className="flex-row items-center py-4 px-4 border-b border-divider last:border-0"
              onPress={() => router.push(item.path as any)}
            >
              <Text className="text-primary flex-1">{item.label}</Text>
              <Ionicons
                name="chevron-forward"
                size={20}
                color={colors.text.muted}
              />
            </Pressable>
          ))}
          <Pressable
            className="py-4 px-4 border-t border-divider"
            onPress={() => setLogoutVisible(true)}
          >
            <Text className="text-error font-semibold">Log Out</Text>
          </Pressable>
          <Pressable
            className="py-4 px-4"
            onPress={() => router.push("/(worker)/profile/delete-account")}
          >
            <Text className="text-error font-semibold">Delete Account</Text>
          </Pressable>
        </View>
      </ScrollView>
      <LogoutConfirmationModal
        visible={logoutVisible}
        onConfirm={() => {
          setLogoutVisible(false);
          logout();
          router.replace("/landing");
        }}
        onCancel={() => setLogoutVisible(false)}
      />
    </SafeAreaView>
  );
}
