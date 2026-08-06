import React from "react";
import { Tabs, Redirect } from "expo-router";
import { AppIcon as Ionicons } from "../../components/icons/AppIcon";
import { View } from "react-native";
import NotificationBadge from "../../components/ui/NotificationBadge";
import { useNotificationStore } from "../../store/notificationStore";
import { useAuthStore } from "../../store/authStore";
import { colors } from "../../constants";

export default function WorkerLayout() {
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const user = useAuthStore((s) => s.user);

  // Gate the worker tabs behind admin approval — this runs on every entry
  // into the (worker) group (deep link, back navigation, resumed session),
  // not just the sign-in redirect, so there's no route into the app for an
  // unverified worker.
  if (user?.role === "worker" && user.kycStatus !== "APPROVED") {
    if (user.kycStatus === "REJECTED") {
      return <Redirect href="/(kyc)/rejected" />;
    }
    if (user.kycStatus === "SUBMITTED") {
      return <Redirect href="/(kyc)/pending" />;
    }
    return <Redirect href="/(kyc)/landing" />;
  }

  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.brand.DEFAULT,
          borderTopColor: colors.divider,
        },
        tabBarActiveTintColor: colors.accent.DEFAULT,
        tabBarInactiveTintColor: colors.white,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons
              name={focused ? "home" : "home-outline"}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="requests"
        options={{
          title: "Requests",
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons
              name={focused ? "clipboard" : "clipboard-outline"}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="records"
        options={{
          title: "Records",
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons
              name={focused ? "documents" : "documents-outline"}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="earnings"
        options={{
          title: "Earnings",
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons
              name={focused ? "wallet" : "wallet-outline"}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: "Inbox",
          tabBarIcon: ({ focused, color, size }) => (
            <View>
              <Ionicons
                name={focused ? "chatbubbles" : "chatbubbles-outline"}
                size={size}
                color={color}
              />
              <NotificationBadge count={unreadCount} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons
              name={focused ? "person-circle" : "person-circle-outline"}
              size={size}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}
