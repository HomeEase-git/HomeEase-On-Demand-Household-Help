import React from "react";
import { Modal, View, Text, Pressable } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { colors, cardShadow } from "../../constants";

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
        className="flex-1 bg-black/60 justify-center items-center px-4"
        onPress={onClose}
      >
        <Pressable
          className="bg-card rounded-2xl p-6 w-full max-w-sm"
          style={cardShadow}
          onPress={(e) => e.stopPropagation()}
        >
          {title && (
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-text-primary font-bold text-lg">{title}</Text>
              <Pressable
                className="w-8 h-8 rounded-full bg-card-light items-center justify-center"
                hitSlop={8}
                onPress={onClose}
              >
                <Ionicons name="close" size={18} color={colors.text.secondary} />
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
