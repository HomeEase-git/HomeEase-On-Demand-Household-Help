import React, { useRef } from "react";
import { View, Text, ScrollView, Pressable, Image, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import VerificationBanner from "../../../components/ui/VerificationBanner";
import ImageSourcePickerBottomSheet from "../../../components/bottom-sheets/ImageSourcePickerBottomSheet";
import LogoutConfirmationModal from "../../../components/modals/LogoutConfirmationModal";
import { useState } from "react";
import type { BottomSheetHandle } from "../../../components/bottom-sheets/BottomSheetWrapper";
import { useAuthStore } from "../../../store/authStore";
import { colors, cardShadow } from "../../../constants";
import { uploadAvatar, updateUserProfile } from "../../../services/api";

const MENU_GROUPS = [
  [
    { label: "My Reviews", path: "/(client)/profile/reviews" },
    { label: "Payment Methods", path: "/(client)/profile/payment-methods" },
    { label: "Manage Addresses", path: "/(client)/profile/addresses" },
    { label: "Transaction History", path: "/(client)/profile/transactions" },
  ],
  [
    { label: "Change Password", path: "/(client)/profile/change-password" },
    {
      label: "Notification Preferences",
      path: "/(client)/profile/notification-preferences",
    },
    { label: "Privacy Settings", path: "/(client)/profile/privacy-settings" },
  ],
  [
    { label: "Help & Support", path: "/(client)/profile/help-support" },
    { label: "Contact Us", path: "/(client)/profile/contact-us" },
    { label: "About the App", path: "/(client)/profile/about" },
  ],
  [
    { label: "Terms and Conditions", path: "/(client)/profile/terms" },
    { label: "Privacy Policy", path: "/(client)/profile/privacy-policy" },
  ],
];

export default function ClientProfileScreen() {
  const router = useRouter();
  const imageSheetRef = useRef<BottomSheetHandle | null>(null);
  const [logoutVisible, setLogoutVisible] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);

  const displayName = user?.name ?? "Guest";
  const displayEmail = user?.email ?? "";

  const handleAvatarSelected = async (uri: string) => {
    if (!user) return;
    setUploadingAvatar(true);
    try {
      const { url } = await uploadAvatar(uri);
      const updated = await updateUserProfile({ avatar: url });
      setUser({ ...user, avatar: updated.avatar });
    } catch (error) {
      console.error("Avatar upload error", error);
      Alert.alert(
        "Upload failed",
        "We could not update your profile picture. Please try again.",
      );
    } finally {
      setUploadingAvatar(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        <View className="bg-card rounded-2xl p-5 mx-4 mt-4" style={cardShadow}>
          <View className="flex-row items-center">
            <View className="w-20 h-20 bg-accent rounded-full items-center justify-center overflow-hidden">
              {user?.avatar ? (
                <Image
                  source={{ uri: user.avatar }}
                  style={{ width: 80, height: 80 }}
                  resizeMode="cover"
                />
              ) : (
                <Ionicons name="person" size={40} color={colors.white} />
              )}
              {uploadingAvatar && (
                <View
                  className="absolute inset-0 bg-black/40 items-center justify-center"
                  style={{ width: 80, height: 80 }}
                >
                  <ActivityIndicator color={colors.white} />
                </View>
              )}
            </View>
            <Pressable
              className="absolute bottom-0 left-14 w-8 h-8 bg-brand rounded-full items-center justify-center"
              onPress={() => imageSheetRef.current?.expand()}
              disabled={uploadingAvatar}
            >
              <Ionicons name="camera" size={16} color={colors.white} />
            </Pressable>
            <View className="ml-4 flex-1">
              <Text className="text-text-primary font-bold text-xl">
                {displayName}
              </Text>
              <Text className="text-text-secondary text-sm">
                {displayEmail}
              </Text>
              <Pressable
                className="mt-2"
                onPress={() => router.push("/(client)/profile/edit")}
              >
                <Text className="text-accent font-semibold text-sm">
                  Edit Profile
                </Text>
              </Pressable>
            </View>
          </View>
        </View>

        <View className="mx-4 mt-3">
          <VerificationBanner
            isVerified={false}
            onVerifyPress={() => router.push("/(kyc)/landing")}
          />
        </View>

        {MENU_GROUPS.map((group, gi) => (
          <View
            key={gi}
            className="bg-card rounded-2xl mx-4 mt-3 overflow-hidden"
            style={cardShadow}
          >
            {group.map((item) => (
              <Pressable
                key={item.label}
                className="flex-row items-center py-4 px-4 border-b border-divider last:border-0"
                onPress={() => router.push(item.path as any)}
              >
                <Text className="text-text-primary flex-1">{item.label}</Text>
                <Ionicons
                  name="chevron-forward"
                  size={20}
                  color={colors.text.muted}
                />
              </Pressable>
            ))}
          </View>
        ))}

        <View className="bg-error/10 rounded-2xl mx-4 mt-3 overflow-hidden">
          <Pressable
            className="flex-row items-center py-4 px-4"
            onPress={() => setLogoutVisible(true)}
          >
            <Text className="text-error flex-1 font-semibold">Log Out</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.error} />
          </Pressable>
          <Pressable
            className="flex-row items-center py-4 px-4 border-t border-divider"
            onPress={() => router.push("/(client)/profile/delete-account")}
          >
            <Text className="text-error flex-1 font-semibold">
              Delete Account
            </Text>
            <Ionicons name="chevron-forward" size={20} color={colors.error} />
          </Pressable>
        </View>
      </ScrollView>
      <ImageSourcePickerBottomSheet
        innerRef={imageSheetRef}
        onSelect={handleAvatarSelected}
      />
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
