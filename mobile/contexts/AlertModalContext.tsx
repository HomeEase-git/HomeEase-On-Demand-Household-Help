import React, { createContext, useCallback, useContext, useState } from "react";
import AlertModal, {
  AlertModalButton,
  AlertModalVariant,
} from "../components/modals/AlertModal";

export type { AlertModalButton, AlertModalVariant };

export interface ShowAlertOptions {
  variant: AlertModalVariant;
  title: string;
  message?: string;
  buttons?: AlertModalButton[];
}

export interface ConfirmOptions {
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
}

interface AlertModalContextType {
  showAlert: (options: ShowAlertOptions) => void;
  info: (title: string, message?: string, buttons?: AlertModalButton[]) => void;
  success: (title: string, message?: string, buttons?: AlertModalButton[]) => void;
  warning: (title: string, message?: string, buttons?: AlertModalButton[]) => void;
  error: (title: string, message?: string, buttons?: AlertModalButton[]) => void;
  confirm: (title: string, message?: string, options?: ConfirmOptions) => void;
  hideAlert: () => void;
}

const AlertModalContext = createContext<AlertModalContextType | undefined>(
  undefined,
);

export const useAlertModal = () => {
  const context = useContext(AlertModalContext);
  if (!context) {
    throw new Error("useAlertModal must be used within AlertModalProvider");
  }
  return context;
};

export const AlertModalProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [visible, setVisible] = useState(false);
  const [options, setOptions] = useState<ShowAlertOptions>({
    variant: "info",
    title: "",
  });

  const showAlert = useCallback((opts: ShowAlertOptions) => {
    setOptions(opts);
    setVisible(true);
  }, []);

  const hideAlert = useCallback(() => {
    setVisible(false);
  }, []);

  const info = useCallback(
    (title: string, message?: string, buttons?: AlertModalButton[]) =>
      showAlert({ variant: "info", title, message, buttons }),
    [showAlert],
  );

  const success = useCallback(
    (title: string, message?: string, buttons?: AlertModalButton[]) =>
      showAlert({ variant: "success", title, message, buttons }),
    [showAlert],
  );

  const warning = useCallback(
    (title: string, message?: string, buttons?: AlertModalButton[]) =>
      showAlert({ variant: "warning", title, message, buttons }),
    [showAlert],
  );

  const error = useCallback(
    (title: string, message?: string, buttons?: AlertModalButton[]) =>
      showAlert({ variant: "error", title, message, buttons }),
    [showAlert],
  );

  const confirm = useCallback(
    (title: string, message?: string, opts?: ConfirmOptions) =>
      showAlert({
        variant: opts?.destructive ? "error" : "warning",
        title,
        message,
        buttons: [
          {
            text: opts?.cancelText || "Cancel",
            style: "cancel",
            onPress: opts?.onCancel,
          },
          {
            text: opts?.confirmText || "Confirm",
            style: opts?.destructive ? "destructive" : "default",
            onPress: opts?.onConfirm,
          },
        ],
      }),
    [showAlert],
  );

  return (
    <AlertModalContext.Provider
      value={{ showAlert, info, success, warning, error, confirm, hideAlert }}
    >
      {children}
      <AlertModal
        visible={visible}
        variant={options.variant}
        title={options.title}
        message={options.message}
        buttons={options.buttons}
        onRequestClose={hideAlert}
      />
    </AlertModalContext.Provider>
  );
};
