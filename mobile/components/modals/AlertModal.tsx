import React from "react";
import { View, Text } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import ModalWrapper from "./ModalWrapper";
import PrimaryButton from "../ui/PrimaryButton";
import OutlinedButton from "../ui/OutlinedButton";
import DangerButton from "../ui/DangerButton";
import { colors } from "../../constants";

export type AlertModalVariant = "info" | "success" | "warning" | "error";

export type AlertModalButton = {
  text: string;
  onPress?: () => void;
  style?: "default" | "cancel" | "destructive";
};

type Props = {
  visible: boolean;
  variant: AlertModalVariant;
  title: string;
  message?: string;
  buttons?: AlertModalButton[];
  onRequestClose: () => void;
};

const VARIANT_CONFIG: Record<
  AlertModalVariant,
  { icon: React.ComponentProps<typeof Ionicons>["name"]; color: string; bg: string }
> = {
  info: { icon: "information-circle", color: colors.brand.DEFAULT, bg: "bg-brand/10" },
  success: { icon: "checkmark-circle", color: colors.success, bg: "bg-success/10" },
  warning: { icon: "warning", color: colors.warning, bg: "bg-warning/10" },
  error: { icon: "alert-circle", color: colors.error, bg: "bg-error/10" },
};

export const AlertModal: React.FC<Props> = ({
  visible,
  variant,
  title,
  message,
  buttons,
  onRequestClose,
}) => {
  const { icon, color, bg } = VARIANT_CONFIG[variant];
  const resolvedButtons: AlertModalButton[] =
    buttons && buttons.length > 0 ? buttons : [{ text: "OK", style: "default" }];

  const handlePress = (button: AlertModalButton) => {
    onRequestClose();
    button.onPress?.();
  };

  return (
    <ModalWrapper visible={visible} onClose={onRequestClose}>
      <View className="items-center mb-4">
        <View className={`w-16 h-16 rounded-full ${bg} items-center justify-center`}>
          <Ionicons name={icon} size={36} color={color} />
        </View>
      </View>
      <Text className="text-text-primary font-bold text-lg text-center">
        {title}
      </Text>
      {!!message && (
        <Text className="text-text-secondary text-center mt-2">{message}</Text>
      )}
      <View
        className={
          resolvedButtons.length > 1
            ? "flex-row gap-3 mt-6"
            : "mt-6"
        }
      >
        {resolvedButtons.map((button, index) => {
          const key = `${button.text}-${index}`;
          const isFullWidth = resolvedButtons.length === 1;

          if (button.style === "cancel") {
            return (
              <View key={key} className={isFullWidth ? "" : "flex-1"}>
                <OutlinedButton
                  label={button.text}
                  fullWidth={isFullWidth}
                  onPress={() => handlePress(button)}
                />
              </View>
            );
          }

          if (button.style === "destructive") {
            return (
              <View key={key} className={isFullWidth ? "" : "flex-1"}>
                <DangerButton
                  label={button.text}
                  fullWidth={isFullWidth}
                  onPress={() => handlePress(button)}
                />
              </View>
            );
          }

          return (
            <View key={key} className={isFullWidth ? "" : "flex-1"}>
              <PrimaryButton
                label={button.text}
                fullWidth={isFullWidth}
                onPress={() => handlePress(button)}
              />
            </View>
          );
        })}
      </View>
    </ModalWrapper>
  );
};

export default AlertModal;
