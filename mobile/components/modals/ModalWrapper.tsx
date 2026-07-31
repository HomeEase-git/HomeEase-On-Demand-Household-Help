import React from "react";
import { Modal, View, Text, Pressable } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { colors } from "../../constants";

type Props = {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
};

export const ModalWrapper: React.FC<Props> = ({
  visible,
  onClose,
  children,
  title,
}) => {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        className="flex-1 bg-black/60 justify-end items-center"
        onPress={onClose}
      >
        <Pressable
          className="bg-card rounded-2xl p-6 mx-4 w-full max-w-sm"
          onPress={(e) => e.stopPropagation()}
        >
          {title && (
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-text-primary font-bold text-lg">{title}</Text>
              <Pressable onPress={onClose}>
                <Ionicons name="close" size={24} color={colors.white} />
              </Pressable>
            </View>
          )}
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
};

export default ModalWrapper;
