import "react-native-reanimated";
import "../global.css";
import React, { useEffect, useRef } from "react";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ToastProvider } from "../contexts/ToastContext";
import { AlertModalProvider } from "../contexts/AlertModalContext";
import { useAuthStore } from "../store/authStore";
import { useBookingStore } from "../store/bookingStore";
import { useMessageStore } from "../store/messageStore";
import { useNotificationStore } from "../store/notificationStore";
import * as api from "../services/api";
import { connectSocket, disconnectSocket } from "../services/socket";
import {
  initializeNotificationService,
  notificationService,
} from "../services/notificationService";
import {
  setupNotificationReceivedHandler,
  setupNotificationInteractionHandler,
} from "../utils/notificationHandlers";
import { initializeOfflineSupport } from "../hooks/useOfflineSupport";
import { setupGlobalErrorHandler } from "../utils/errorHandling";
import { colors } from "../constants";

// Keep splash screen visible while loading
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const initializeAuth = useAuthStore((state) => state.initializeAuth);
  const restoreDraft = useBookingStore((state) => state.restoreDraft);
  const token = useAuthStore((state) => state.token);
  const [fontsLoaded] = useFonts({
    // Add any custom fonts here if needed
  });

  useEffect(() => {
    if (!token) return;

    const socket = connectSocket(token);

    socket.on("message:new", (message) => {
      const currentUserId = useAuthStore.getState().user?.id;
      if (!currentUserId) return;

      const otherUserId =
        message.senderId === currentUserId ? message.receiverId : message.senderId;
      const hasConversation = useMessageStore
        .getState()
        .conversations.some((c) => c.userId === otherUserId);

      if (!hasConversation) {
        api
          .getConversations()
          .then((conversations) => useMessageStore.getState().setConversations(conversations))
          .catch((error) => console.error("Refresh conversations error:", error));
      }

      useMessageStore.getState().receiveMessage(currentUserId, message);
    });

    socket.on("notification:new", (notification) => {
      useNotificationStore.getState().receiveNotification(notification);
    });

    return () => {
      disconnectSocket();
    };
  }, [token]);

  useEffect(() => {
    // Initialize all services on app startup
    const initialize = async () => {
      try {
        // Setup global error handling
        setupGlobalErrorHandler();

        // Initialize auth and booking draft
        await initializeAuth();
        await restoreDraft();

        // Initialize offline support
        initializeOfflineSupport();

        // Initialize notifications
        await initializeNotificationService();
        setupNotificationReceivedHandler();
        setupNotificationInteractionHandler();

        console.log("[App] All services initialized");
      } catch (error) {
        console.error("[App] Initialization error:", error);
      } finally {
        // Hide splash screen when ready
        if (fontsLoaded) {
          await SplashScreen.hideAsync();
        }
      }
    };

    initialize();
  }, [initializeAuth, restoreDraft, fontsLoaded]);

  return (
    <GestureHandlerRootView className="flex-1 bg-white">
      <SafeAreaProvider>
        <ToastProvider>
          <AlertModalProvider>
            <Stack
              screenOptions={{
                headerShown: false,
                animation: "slide_from_right",
                animationDuration: 250,
                contentStyle: { backgroundColor: colors.surface },
                headerStyle: { backgroundColor: colors.surface },
                headerTintColor: colors.text.primary,
                headerShadowVisible: false,
              }}
            />
          </AlertModalProvider>
        </ToastProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
