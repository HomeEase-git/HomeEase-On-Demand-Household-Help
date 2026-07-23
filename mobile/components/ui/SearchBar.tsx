import React from "react";
import { View, TextInput, Pressable, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../constants";

type Props = {
  placeholder?: string;
  onPress?: () => void;
  onChangeText?: (text: string) => void;
  value?: string;
  onFilterPress?: () => void;
};

export const SearchBar: React.FC<Props> = ({
  placeholder = "Search...",
  onPress,
  onChangeText,
  value = "",
  onFilterPress,
}) => {
  const content = (
    <View className="flex-row items-center bg-gray-100 border border-primary-light rounded-full px-4 py-3">
      <Ionicons name="search-outline" size={20} color={colors.text.muted} />
      {onPress ? (
        <Text className="flex-1 ml-3 text-primary text-sm">{placeholder}</Text>
      ) : (
        <TextInput
          className="flex-1 ml-3 text-primary text-sm"
          placeholder={placeholder}
          placeholderTextColor={colors.text.muted}
          value={value}
          onChangeText={onChangeText}
        />
      )}
      {onFilterPress && (
        <Pressable onPress={onFilterPress}>
          <Ionicons
            name="options-outline"
            size={20}
            color={colors.text.muted}
          />
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
