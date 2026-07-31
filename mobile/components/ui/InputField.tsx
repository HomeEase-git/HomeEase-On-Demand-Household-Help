import React, { useState, forwardRef } from "react";
import { Text, TextInput, Pressable, TextInputProps, View } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { colors } from "../../constants";
import FieldError from "./FieldError";

type Props = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  multiline?: boolean;
  editable?: boolean;
  error?: string | null;
  returnKeyType?: TextInputProps["returnKeyType"];
  onSubmitEditing?: TextInputProps["onSubmitEditing"];
  boldLabel?: boolean;
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
      error,
      keyboardType,
      autoCapitalize,
      returnKeyType,
      onSubmitEditing,
      boldLabel = false,
    },
    ref,
  ) => {
    const [isSecure, setIsSecure] = useState(!!secureTextEntry);

    return (
      <View className="mb-4">
        <Text
          className={`text-text-secondary text-sm mb-1 ${boldLabel ? "font-bold" : ""}`}
        >
          {label}
        </Text>
        <View
          className={`flex-row items-center bg-gray-100 border rounded-xl px-4 ${
            multiline ? "py-3" : "py-1.5"
          } ${!editable ? "opacity-60 bg-card-dark" : ""} ${
            error ? "border-error" : "border-divider"
          }`}
        >
          <TextInput
            ref={ref}
            className={`flex-1 text-text-primary ${
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
            // Android's Autofill framework can hold a reference to this
            // EditText and touch it (e.g. for a "Save password?" prompt)
            // at the same moment Fabric tears the view down on navigation,
            // which crashes with "specified child already has a parent".
            // These forms don't rely on autofill, so just opt out of it.
            importantForAutofill="no"
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
        <FieldError message={error} />
      </View>
    );
  },
);

InputField.displayName = "InputField";

export default InputField;
