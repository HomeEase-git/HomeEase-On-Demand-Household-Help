import React, { useState } from "react";
import { View, TextInput, Pressable, Text } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { colors } from "../../constants";

type Props = {
  placeholder?: string;
  onPress?: () => void;
  onChangeText?: (text: string) => void;
  value?: string;
  onFilterPress?: () => void;
  filterActive?: boolean;
};

export const SearchBar: React.FC<Props> = ({
  placeholder = "Search...",
  onPress,
  onChangeText,
  value,
  onFilterPress,
  filterActive = false,
}) => {
  // Only treat this as a controlled input when a parent actually passes
  // `value`. Otherwise, defaulting `value` to "" would pin the TextInput to
  // an empty string forever and every keystroke would be reverted on the
  // next render.
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState("");
  const inputValue = isControlled ? value : internalValue;

  const handleChangeText = (text: string) => {
    if (!isControlled) setInternalValue(text);
    onChangeText?.(text);
  };

  const content = (
    <View className="flex-row items-center bg-gray-100 border border-brand-light rounded-full px-4 py-3">
      <Ionicons name="search-outline" size={20} color={colors.text.muted} />
      {onPress ? (
        <Text className="flex-1 ml-3 text-brand text-sm">{placeholder}</Text>
      ) : (
        <TextInput
          className="flex-1 ml-3 text-brand text-sm"
          placeholder={placeholder}
          placeholderTextColor={colors.text.muted}
          value={inputValue}
          onChangeText={handleChangeText}
        />
      )}
      {onFilterPress && (
        <Pressable onPress={onFilterPress} className="relative">
          <Ionicons
            name="options-outline"
            size={20}
            color={filterActive ? colors.accent.DEFAULT : colors.text.muted}
          />
          {filterActive && (
            <View className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-accent" />
          )}
        </Pressable>
      )}
    </View>
  );

  if (onPress) {
    return <Pressable onPress={onPress}>{content}</Pressable>;
  }
  return content;
};

export default SearchBar;
