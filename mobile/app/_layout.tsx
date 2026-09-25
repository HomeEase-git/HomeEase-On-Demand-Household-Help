import "react-native-reanimated";
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
import { useAuthStore } from "../store/authStore";
import { useBookingStore } from "../store/bookingStore";
import { useMessageStore } from "../store/messageStore";
import { useNotificationStore } from "../store/notificationStore";
import { useWorkerStore } from "../store/workerStore";
import * as api from "../services/api";
import { connectSocket, disconnectSocket } from "../services/socket";
import { initializeNotificationService } from "../services/notificationService";
import {
  setupNotificationReceivedHandler,
  setupNotificationInteractionHandler,
} from "../utils/notificationHandlers";
import { initializeOfflineSupport } from "../hooks/useOfflineSupport";
import { setupGlobalErrorHandler } from "../utils/errorHandling";
import { colors } from "../constants";

// Keep splash screen visible while loading
SplashScreen.preventAutoHideAsync();

// Full active-booking catch-up refetch — shared by the socket "connect"
// handler (fires on the initial connect AND every reconnect after a drop)
// and the AppState foreground listener below. Both cover the same gap:
// live updates normally arrive via "notification:new" socket events, but
// those are only delivered while connected and in the foreground — a
// dropped/restored connection or a backgrounded-then-resumed app can miss
// them entirely, and Android push notifications (the other fallback) are
// known to not always reach the device either. Refetching in full on both
// triggers means booking state self-heals regardless of which delivery
// path failed.
function refetchActiveBookings() {
  const currentUser = useAuthStore.getState().user;
  if (!currentUser) return;
  if (currentUser.role === "worker") {
    useWorkerStore.getState().refreshJobs();
  } else {
    useBookingStore.getState().refreshBookings();
  }
}

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

    // Catch-up refetch on every (re)connect — socket.io fires "connect" both
    // for the initial handshake and again after any reconnect, so this also
    // covers a flaky network dropping and restoring the connection while the
    // app stays open/foregrounded.
    socket.on("connect", refetchActiveBookings);

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

      const currentUser = useAuthStore.getState().user;

      // Live-update the cached KYC status so a worker sitting on the waiting
      // screen (which has no buttons/refresh control) advances automatically
      // as soon as an admin decides, instead of needing to relaunch the app.
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

      // A new job request (or one leaving the worker's list — cancelled,
      // auto-approved, etc.) should update the jobs list even when the
      // Requests screen isn't focused/polling (e.g. worker sitting on Home).
      const JOB_LIST_AFFECTING_TYPES = [
        "BOOKING_REQUEST",
        "BOOKING_CANCELLED",
        "QUOTE_AUTO_APPROVED",
        "BOOKING_AUTO_COMPLETED",
      ];
      if (currentUser?.role === "worker" && JOB_LIST_AFFECTING_TYPES.includes(notification.type)) {
        useWorkerStore.getState().refreshJobs();
      }
    });

    return () => {
      disconnectSocket();
    };
  }, [token]);

  useEffect(() => {
    // The socket's own "connect" event doesn't reliably fire on every
    // foreground — a brief backgrounding often leaves the underlying
    // connection alive (no reconnect), yet the app can still have been away
    // long enough for booking state to go stale. This is the independent
    // second trigger: refetch on every transition back to "active",
    // regardless of what the socket did while backgrounded.
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

        // Refresh the worker's KYC status from the server on every launch —
        // the cached value from the last login can be stale if an admin
        // approved/rejected the account while the app was closed, and the
        // (worker) layout guard depends on this being current.
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
      {/* Tracks the keyboard for KeyboardAwareScrollView & co. The app is
          already edge-to-edge, so keep both system bars translucent rather
          than letting the provider change the window layout. */}
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
            </AlertModalProvider>
          </ToastProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
