import React from "react";
import { Tabs } from "expo-router";
import { AppIcon as Ionicons } from "../../components/icons/AppIcon";
import { View } from "react-native";
import NotificationBadge from "../../components/ui/NotificationBadge";
import { useNotificationStore } from "../../store/notificationStore";
import { colors } from "../../constants";

export default function ClientLayout() {
  const unreadCount = useNotificationStore((s) => s.unreadCount);

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
