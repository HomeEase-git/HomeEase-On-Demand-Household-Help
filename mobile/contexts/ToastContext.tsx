import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { View, Text, Animated, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../constants";

export type ToastType = "success" | "error" | "info" | "warning";

interface ToastContextType {
  showToast: (message: string, type: ToastType, duration?: number) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToastContext = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToastContext must be used within ToastProvider");
  }
  return context;
};

type ToastEntry = {
  id: number;
  message: string;
  type: ToastType;
  opacity: Animated.Value;
};

const TOAST_COLORS: Record<ToastType, string> = {
  success: colors.success,
  error: colors.error,
  info: colors.accent.DEFAULT,
  warning: colors.warning,
};

let nextToastId = 0;

// Custom, minimal toast implementation.
//
// The previous implementation used `react-native-toast-notifications`, whose
// container internally renders the deprecated core-RN `SafeAreaView` (not
// `react-native-safe-area-context`'s). That component is persistently
// mounted at the app root, and under the New Architecture (Fabric) it
// triggers a reproducible native crash ("addViewAt: ... specified child
// already has a parent") on the very first render, unrelated to when a toast
// is actually shown. This implementation avoids that dependency entirely.
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const insets = useSafeAreaInsets();
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const removeToast = useCallback((id: number) => {
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = "info", duration: number = 3000) => {
      const id = nextToastId++;
      const opacity = new Animated.Value(0);
      setToasts((current) => [...current, { id, message, type, opacity }]);

      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();

      timers.current[id] = setTimeout(() => {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }).start(() => removeToast(id));
      }, duration);
    },
    [removeToast],
  );

  const success = useCallback(
    (message: string, duration?: number) =>
      showToast(message, "success", duration),
    [showToast],
  );

  const error = useCallback(
    (message: string, duration?: number) =>
      showToast(message, "error", duration),
    [showToast],
  );

  const info = useCallback(
    (message: string, duration?: number) =>
      showToast(message, "info", duration),
    [showToast],
  );

  const warning = useCallback(
    (message: string, duration?: number) =>
      showToast(message, "warning", duration),
    [showToast],
  );

  return (
    <ToastContext.Provider value={{ showToast, success, error, info, warning }}>
      {children}
      <View
        pointerEvents="none"
        style={[styles.container, { top: insets.top + 8 }]}
      >
        {toasts.map((t) => (
          <Animated.View
            key={t.id}
            style={[
              styles.toast,
              { backgroundColor: TOAST_COLORS[t.type], opacity: t.opacity },
            ]}
          >
            <Text style={styles.text} numberOfLines={3}>
              {t.message}
            </Text>
          </Animated.View>
        ))}
      </View>
    </ToastContext.Provider>
  );
};

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 9999,
    elevation: 9999,
  },
  toast: {
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  text: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "500",
  },
});
