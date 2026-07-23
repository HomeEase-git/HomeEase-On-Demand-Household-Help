import React, { useState, forwardRef } from "react";
import { Text, TextInput, Pressable, TextInputProps, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../constants";

type Props = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  multiline?: boolean;
  editable?: boolean;
  returnKeyType?: TextInputProps["returnKeyType"];
  onSubmitEditing?: TextInputProps["onSubmitEditing"];
} & Pick<TextInputProps, "keyboardType" | "autoCapitalize">;

export const InputField = forwardRef<TextInput, Props>(
  (
    {
      label,
      value,
      onChangeText,
      placeholder,
      secureTextEntry,
      multiline,
      editable = true,
      keyboardType,
      autoCapitalize,
      returnKeyType,
      onSubmitEditing,
    },
    ref,
  ) => {
    const [isSecure, setIsSecure] = useState(!!secureTextEntry);

    return (
      <View className="mb-4">
        <Text className="text-primary text-sm mb-1">{label}</Text>
        <View
          className={`flex-row items-center bg-gray-100 border border-primary-light rounded-xl px-4 ${
            multiline ? "py-3" : "py-1.5"
          } ${!editable ? "opacity-60 bg-card-dark" : ""}`}
        >
          <TextInput
            ref={ref}
            className={`flex-1 text-primary ${
              multiline ? "min-h-[80px] text-top" : "h-10"
            }`}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={colors.text.muted}
            secureTextEntry={isSecure}
            multiline={multiline}
            editable={editable}
            keyboardType={keyboardType}
            autoCapitalize={autoCapitalize}
            returnKeyType={returnKeyType}
            onSubmitEditing={onSubmitEditing}
          />
          {secureTextEntry && (
            <Pressable onPress={() => setIsSecure((prev) => !prev)}>
              <Ionicons
                name={isSecure ? "eye-off-outline" : "eye-outline"}
                size={20}
                color={colors.text.muted}
              />
            </Pressable>
          )}
        </View>
      </View>
    );
  },
);

InputField.displayName = "InputField";

export default InputField;
