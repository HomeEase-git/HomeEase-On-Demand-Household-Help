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
  { icon: React.ComponentProps<typeof Ionicons>["name"]; color: string }
> = {
  info: { icon: "information-circle", color: colors.brand.DEFAULT },
  success: { icon: "checkmark-circle", color: colors.success },
  warning: { icon: "warning", color: colors.warning },
  error: { icon: "alert-circle", color: colors.error },
};

export const AlertModal: React.FC<Props> = ({
  visible,
  variant,
  title,
  message,
  buttons,
  onRequestClose,
}) => {
  const { icon, color } = VARIANT_CONFIG[variant];
  const resolvedButtons: AlertModalButton[] =
    buttons && buttons.length > 0 ? buttons : [{ text: "OK", style: "default" }];

  const handlePress = (button: AlertModalButton) => {
    onRequestClose();
    button.onPress?.();
  };

  return (
    <ModalWrapper visible={visible} onClose={onRequestClose}>
      <View className="items-center mb-4">
        <Ionicons name={icon} size={48} color={color} />
      </View>
      <Text className="text-text-primary font-bold text-lg text-center">
        {title}
      </Text>
      {!!message && (
        <Text className="text-brand text-center mt-2">{message}</Text>
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
