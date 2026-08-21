import React, { useCallback, useRef, useState } from "react";
import { View, Text, ScrollView, Pressable, Image, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../../components/icons/AppIcon";
import { useRouter, useFocusEffect } from "expo-router";
import StarRating from "../../../components/ui/StarRating";
import LogoutConfirmationModal from "../../../components/modals/LogoutConfirmationModal";
import ImageSourcePickerBottomSheet from "../../../components/bottom-sheets/ImageSourcePickerBottomSheet";
import type { BottomSheetHandle } from "../../../components/bottom-sheets/BottomSheetWrapper";
import { useAuthStore } from "../../../store/authStore";
import * as api from "../../../services/api";
import type { WorkerDetail } from "../../../types/api.types";
import { colors, cardShadow } from "../../../constants";
import { useAlertModal } from "../../../contexts/AlertModalContext";
import { useTabRefresh } from "../../../hooks/useTabRefresh";

const MENU_GROUPS = [
  {
    title: "Professional Profile",
    items: [
      { label: "Edit Profile", path: "/(worker)/profile/edit", icon: "person-outline" },
      { label: "Digital ID", path: "/(worker)/profile/digital-id", icon: "card-outline" },
      { label: "My Skills & Services", path: "/(worker)/profile/skills", icon: "construct-outline" },
      { label: "My Packages", path: "/(worker)/profile/packages", icon: "cube-outline" },
      { label: "Set Availability", path: "/(worker)/profile/availability", icon: "calendar-outline" },
      { label: "My Certifications", path: "/(worker)/profile/certifications", icon: "ribbon-outline" },
      { label: "My Reviews", path: "/(worker)/profile/reviews", icon: "star-outline" },
      { label: "Resume Analysis (AI)", path: "/(worker)/profile/resume-preview", icon: "sparkles-outline" },
    ],
  },
  {
    title: "Earnings",
    items: [
      { label: "Payout Method", path: "/(worker)/earnings/payout", icon: "wallet-outline" },
    ],
  },
  {
    title: "Account",
    items: [
      { label: "Change Password", path: "/(worker)/profile/change-password", icon: "lock-closed-outline" },
      {
        label: "Notification Preferences",
        path: "/(worker)/profile/notification-preferences",
        icon: "notifications-outline",
      },
      { label: "Privacy Settings", path: "/(worker)/profile/privacy-settings", icon: "shield-checkmark-outline" },
    ],
  },
  {
    title: "Support & Legal",
    items: [
      { label: "Help & Support", path: "/(worker)/profile/help-support", icon: "help-circle-outline" },
      { label: "Terms and Conditions", path: "/(worker)/profile/terms", icon: "document-text-outline" },
      { label: "Privacy Policy", path: "/(worker)/profile/privacy-policy", icon: "shield-outline" },
      { label: "About HomeEase", path: "/(worker)/profile/about", icon: "information-circle-outline" },
    ],
  },
] as const;

export default function WorkerProfileScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const imageSheetRef = useRef<BottomSheetHandle | null>(null);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);
  const [logoutVisible, setLogoutVisible] = useState(false);
  const [detail, setDetail] = useState<WorkerDetail | null>(null);
  const [verified, setVerified] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const handleAvatarSelected = async (uri: string) => {
    if (!user) return;
    setUploadingAvatar(true);
    try {
      const { url } = await api.uploadAvatar(uri);
      const updated = await api.updateUserProfile({ avatar: url });
      setUser({ ...user, avatar: updated.avatar });
    } catch (error) {
      console.error("Avatar upload error", error);
      alertModal.error(
        "Upload failed",
        "We could not update your profile picture. Please try again.",
      );
    } finally {
      setUploadingAvatar(false);
    }
  };

  const load = useCallback(async () => {
    if (!user?.id) return;
    try {
      const result = await api.getWorkerDetail(user.id);
      setDetail(result);
    } catch (error) {
      console.error("Load worker profile error:", error);
    }
    try {
      const digitalId = await api.getMyDigitalId();
      setVerified(digitalId.verified);
    } catch (error) {
      console.error("Load digital ID error:", error);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useTabRefresh("worker:profile", load);

  const displayName = user?.name ?? "Worker";
  const displayEmail = user?.email ?? "—";
  const displayPhone = user?.phone ?? "—";

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View
          className="bg-card rounded-2xl p-5 mx-4 mt-4 flex-row items-center"
          style={cardShadow}
        >
          <View className="relative mr-3">
            <View className="w-16 h-16 bg-accent rounded-full items-center justify-center overflow-hidden">
              {user?.avatar ? (
                <Image
                  source={{ uri: user.avatar }}
                  style={{ width: 64, height: 64 }}
                  resizeMode="cover"
                />
              ) : (
                <Ionicons name="person" size={32} color={colors.white} />
              )}
              {uploadingAvatar && (
                <View
                  className="absolute inset-0 bg-black/40 items-center justify-center"
                  style={{ width: 64, height: 64 }}
                >
                  <ActivityIndicator color={colors.white} />
                </View>
              )}
            </View>
            <Pressable
              className="absolute bottom-0 right-0 w-6 h-6 bg-brand rounded-full items-center justify-center"
              onPress={() => imageSheetRef.current?.expand()}
              disabled={uploadingAvatar}
            >
              <Ionicons name="camera" size={12} color={colors.white} />
            </Pressable>
          </View>
          <View className="flex-1">
            <View className="flex-row items-center">
              <Text className="text-text-primary font-bold text-lg">
                {displayName}
              </Text>
              <View className="ml-1">
                <Ionicons
                  name={verified ? "checkmark-circle" : "time-outline"}
                  size={18}
                  color={verified ? colors.success : colors.warning}
                />
              </View>
            </View>
            <Text
              className="text-xs"
              style={{ color: verified ? colors.success : colors.warning }}
            >
              {verified ? "Verified Professional" : "Verification Pending"}
            </Text>
            <View className="flex-row items-center mt-1">
              <StarRating rating={detail?.rating ?? 0} size={14} />
              <Text className="text-text-muted text-xs ml-2">
                {detail?.reviews ?? 0} review{(detail?.reviews ?? 0) !== 1 ? "s" : ""}
              </Text>
            </View>
          </View>
        </View>

        <View className="bg-card rounded-2xl p-4 mx-4 mt-3" style={cardShadow}>
          <Text className="text-text-primary font-bold mb-2">
            Skills and Expertise
          </Text>
          {detail?.skills && detail.skills.length > 0 ? (
            <View className="flex-row flex-wrap gap-2">
              {detail.skills.map((s) => (
                <View key={s} className="bg-accent/80 rounded-full px-3 py-1">
                  <Text className="text-white text-sm">{s}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text className="text-text-secondary text-sm">
              No services added yet.
            </Text>
          )}
        </View>

        <View className="bg-card rounded-2xl p-4 mx-4 mt-3" style={cardShadow}>
          <Text className="text-text-primary font-bold mb-2">Contact</Text>
          <View className="bg-card-light rounded-xl p-3 mb-2 flex-row items-center">
            <Ionicons
              name="call-outline"
              size={16}
              color={colors.brand.DEFAULT}
            />
            <Text className="text-text-primary ml-2">{displayPhone}</Text>
            <Text className="text-text-secondary text-xs ml-2">
              Phone Number
            </Text>
          </View>
          <View className="bg-card-light rounded-xl p-3 flex-row items-center">
            <Ionicons
              name="mail-outline"
              size={16}
              color={colors.brand.DEFAULT}
            />
            <Text className="text-text-primary ml-2 flex-1" numberOfLines={1}>
              {displayEmail}
            </Text>
            <Text className="text-text-secondary text-xs ml-2">E-mail</Text>
          </View>
        </View>

        {MENU_GROUPS.map((group) => (
          <View key={group.title}>
            <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide mx-4 mt-4 mb-1">
              {group.title}
            </Text>
            <View
              className="bg-card rounded-2xl mx-4 overflow-hidden"
              style={cardShadow}
            >
              {group.items.map((item) => (
                <Pressable
                  key={item.label}
                  className="flex-row items-center py-3.5 px-4 border-b border-divider last:border-0"
                  onPress={() => router.push(item.path as any)}
                >
                  <View className="w-9 h-9 rounded-full bg-accent/10 items-center justify-center mr-3">
                    <Ionicons name={item.icon} size={18} color={colors.accent.DEFAULT} />
                  </View>
                  <Text className="text-text-primary flex-1">{item.label}</Text>
                  <Ionicons
                    name="chevron-forward"
                    size={20}
                    color={colors.text.muted}
                  />
                </Pressable>
              ))}
            </View>
          </View>
        ))}

        <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide mx-4 mt-4 mb-1">
          Danger Zone
        </Text>
        <View
          className="bg-error/10 rounded-2xl mx-4 overflow-hidden"
        >
          <Pressable
            className="flex-row items-center py-4 px-4"
            onPress={() => setLogoutVisible(true)}
          >
            <View className="w-9 h-9 rounded-full bg-error/10 items-center justify-center mr-3">
              <Ionicons name="log-out-outline" size={18} color={colors.error} />
            </View>
            <Text className="text-error flex-1 font-semibold">Log Out</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.error} />
          </Pressable>
          <Pressable
            className="flex-row items-center py-4 px-4 border-t border-divider"
            onPress={() => router.push("/(worker)/profile/delete-account")}
          >
            <View className="w-9 h-9 rounded-full bg-error/10 items-center justify-center mr-3">
              <Ionicons name="trash-outline" size={18} color={colors.error} />
            </View>
            <Text className="text-error flex-1 font-semibold">Delete Account</Text>
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
