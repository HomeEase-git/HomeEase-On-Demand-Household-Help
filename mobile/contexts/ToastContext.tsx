import React, { createContext, useContext, useCallback } from "react";
import {
  useToast as useNativeToast,
  ToastProvider as NativeToastProvider,
} from "react-native-toast-notifications";

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

// Inner component that safely calls useNativeToast()
// (it's a child of NativeToastProvider, so the hook works here)
const ToastProviderInner: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const toast = useNativeToast();

  const showToast = useCallback(
    (message: string, type: ToastType = "info", duration: number = 3000) => {
      toast.show(message, {
        type,
        placement: "top",
        duration,
        textStyle: {
          color: "#fff",
          fontSize: 14,
          fontWeight: "500",
        },
      });
    },
    [toast],
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
    </ToastContext.Provider>
  );
};

// Outer component wraps with the library's provider first,
// then renders the inner component that can safely use the hook
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  return (
    <NativeToastProvider>
      <ToastProviderInner>{children}</ToastProviderInner>
    </NativeToastProvider>
  );
};
