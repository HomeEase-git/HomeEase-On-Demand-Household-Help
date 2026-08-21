import React from "react";
import { Tabs, Redirect } from "expo-router";
import { AppIcon as Ionicons } from "../../components/icons/AppIcon";
import { View } from "react-native";
import NotificationBadge from "../../components/ui/NotificationBadge";
import { TabRefreshOverlay } from "../../components/ui/TabRefreshOverlay";
import { useNotificationStore } from "../../store/notificationStore";
import { useAuthStore } from "../../store/authStore";
import { useTabRefreshStore } from "../../store/tabRefreshStore";
import { colors } from "../../constants";

export default function ClientLayout() {
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const user = useAuthStore((s) => s.user);
  const triggerRefresh = useTabRefreshStore((s) => s.triggerRefresh);

  // Gate the client tabs behind accepting the user agreement — this runs on
  // every entry into the (client) group, not just the sign-in redirect, so
  // there's no route into the app for a client who hasn't accepted yet.
  if (user?.role === "client" && !user.hasAcceptedTerms) {
    return <Redirect href="/(auth)/client-agreement" />;
  }

  // Re-tapping the already-active tab pops its stack back to the root screen
  // and triggers a refresh, instead of doing nothing (the default behavior).
  const refreshOnRepeatTap = ({ navigation, route }: any) => ({
    tabPress: (e: any) => {
      if (navigation.isFocused()) {
        e.preventDefault();
        navigation.navigate(route.name, { screen: "index" });
        triggerRefresh(`client:${route.name}`);
      }
    },
  });

  return (
    <View style={{ flex: 1 }}>
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
          listeners={refreshOnRepeatTap}
        />
        <Tabs.Screen
          name="category"
          options={{
            title: "Category",
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons
                name={focused ? "grid" : "grid-outline"}
                size={size}
                color={color}
              />
            ),
          }}
          listeners={refreshOnRepeatTap}
        />
        <Tabs.Screen
          name="booking"
          options={{
            title: "Booking",
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons
                name={focused ? "calendar" : "calendar-outline"}
                size={size}
                color={color}
              />
            ),
          }}
          listeners={refreshOnRepeatTap}
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
          listeners={refreshOnRepeatTap}
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
          listeners={refreshOnRepeatTap}
        />
      </Tabs>
      <TabRefreshOverlay />
    </View>
  );
}
