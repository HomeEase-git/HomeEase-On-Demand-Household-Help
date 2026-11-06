import "react-native-reanimated";
import { withMonitoring } from "../utils/monitoring";
import "../global.css";
import React, { useEffect } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ToastProvider } from "../contexts/ToastContext";
import { AlertModalProvider } from "../contexts/AlertModalContext";
import UpdateAvailableModal from "../components/UpdateAvailableModal";
import { useAuthStore } from "../store/authStore";
import { useBookingStore } from "../store/bookingStore";
import { useMessageStore } from "../store/messageStore";
import { useNotificationStore } from "../store/notificationStore";
import { useWorkerStore } from "../store/workerStore";
import * as api from "../services/api";
import { connectSocket, disconnectSocket } from "../services/socket";
import { initializeNotificationService } from "../services/notificationService";
import { initSounds, playSound, type SoundName } from "../utils/sounds";
import {
  setupNotificationReceivedHandler,
  setupNotificationInteractionHandler,
} from "../utils/notificationHandlers";
import { setupGlobalErrorHandler } from "../utils/errorHandling";
import { colors } from "../constants";

// Keep splash screen visible while loading
SplashScreen.preventAutoHideAsync();

function refetchActiveBookings() {
  const currentUser = useAuthStore.getState().user;
  if (!currentUser) return;
  if (currentUser.role === "worker") {
    useWorkerStore.getState().refreshJobs();
  } else {
    useBookingStore.getState().refreshBookings();
  }
}

function RootLayout() {
  const initializeAuth = useAuthStore((state) => state.initializeAuth);
  const restoreDraft = useBookingStore((state) => state.restoreDraft);
  const hasSession = useAuthStore((state) => !!state.token);
  const [fontsLoaded] = useFonts({
    // Add any custom fonts here if needed
  });

  useEffect(() => {
    if (!hasSession) return;

    const socket = connectSocket();

    socket.on("connect", refetchActiveBookings);

    socket.on("message:new", (message) => {
      const currentUserId = useAuthStore.getState().user?.id;
      if (!currentUserId) return;

      const otherUserId =
        message.senderId === currentUserId
          ? message.receiverId
          : message.senderId;
      const hasConversation = useMessageStore
        .getState()
        .conversations.some((c) => c.userId === otherUserId);

      if (!hasConversation) {
        api
          .getConversations()
          .then((conversations) =>
            useMessageStore.getState().setConversations(conversations),
          )
          .catch((error) =>
            console.error("Refresh conversations error:", error),
          );
      }

      useMessageStore.getState().receiveMessage(currentUserId, message);

      if (
        message.senderId !== currentUserId &&
        useMessageStore.getState().openChatUserId !== message.senderId
      ) {
        playSound("message");
      }
    });

    socket.on("notification:new", (notification) => {
      useNotificationStore.getState().receiveNotification(notification);

      const NOTIFICATION_SOUNDS: Record<string, SoundName> = {
        BOOKING_REQUEST: "newJob",
        BOOKING_ACCEPTED: "bookingConfirmed",
      };
      const sound = NOTIFICATION_SOUNDS[notification.type];
      if (sound) playSound(sound);

      const currentUser = useAuthStore.getState().user;

      if (
        notification.type === "VERIFICATION_APPROVED" ||
        notification.type === "VERIFICATION_REJECTED"
      ) {
        if (currentUser?.role === "worker") {
          useAuthStore
            .getState()
            .setKycStatus(
              notification.type === "VERIFICATION_APPROVED"
                ? "APPROVED"
                : "REJECTED",
            );
        }
      }

      const JOB_LIST_AFFECTING_TYPES = [
        "BOOKING_REQUEST",
        "BOOKING_CANCELLED",
        "QUOTE_AUTO_APPROVED",
        "BOOKING_AUTO_COMPLETED",
      ];
      if (
        currentUser?.role === "worker" &&
        JOB_LIST_AFFECTING_TYPES.includes(notification.type)
      ) {
        useWorkerStore.getState().refreshJobs();
      }
    });

    return () => {
      disconnectSocket();
    };
  }, [hasSession]);

  useEffect(() => {
    const subscription = AppState.addEventListener(
      "change",
      (nextState: AppStateStatus) => {
        if (nextState === "active") {
          refetchActiveBookings();
        }
      },
    );

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    // Initialize all services on app startup
    const initialize = async () => {
      try {
        // Setup global error handling
        setupGlobalErrorHandler();

        // Initialize auth and booking draft
        await initializeAuth();
        await restoreDraft();

        const { user } = useAuthStore.getState();
        if (user?.role === "worker") {
          try {
            const profile = await api.getUserProfile();
            if (profile.kycStatus) {
              useAuthStore.getState().setKycStatus(profile.kycStatus);
            }
          } catch (error) {
            console.error("[App] Failed to refresh worker KYC status:", error);
          }
        }

        // Initialize notifications
        await initializeNotificationService();
        await initSounds();
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
      <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
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
              <UpdateAvailableModal />
            </AlertModalProvider>
          </ToastProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

export default withMonitoring(RootLayout);
