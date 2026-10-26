import React from "react";
import { View, Text, ScrollView } from "react-native";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import PrimaryButton from "../ui/PrimaryButton";
import { CATEGORY } from "./NotificationItem";
import { colors } from "../../constants";
import { cardShadow } from "../../constants/shadows";

dayjs.extend(relativeTime);

type Props = {
  category: string;
  title: string;
  message: string;
  createdAt: string;
  actionLabel?: string;
  onAction?: () => void;
};

export const NotificationDetail: React.FC<Props> = ({
  category,
  title,
  message,
  createdAt,
  actionLabel,
  onAction,
}) => {
  const { icon, color, label } = CATEGORY[category] ?? CATEGORY.system;
  const date = dayjs(createdAt);

  return (
    <ScrollView
      className="flex-1 bg-neutral-50"
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
    >
      <View className="rounded-3xl bg-white overflow-hidden" style={cardShadow}>
        <View
          className="items-center pt-8 pb-6"
          style={{ backgroundColor: `${color}18` }}
        >
          <View
            className="w-20 h-20 rounded-full items-center justify-center bg-white"
            style={{ ...cardShadow, shadowColor: color }}
          >
            <Ionicons name={icon} size={38} color={color} />
          </View>
          <View
            className="flex-row items-center px-3 py-1 rounded-full mt-4"
            style={{ backgroundColor: `${color}25` }}
          >
            <View
              className="w-1.5 h-1.5 rounded-full mr-1.5"
              style={{ backgroundColor: color }}
            />
            <Text className="text-xs font-semibold uppercase" style={{ color }}>
              {label}
            </Text>
          </View>
        </View>

        <View className="px-5 pt-5 pb-6">
          <Text className="text-text-primary text-xl font-bold leading-7">
            {title}
          </Text>
          <View className="flex-row items-center mt-2">
            <Ionicons name="time-outline" size={14} color={colors.text.muted} />
            <Text className="text-text-muted text-xs ml-1">
              {date.fromNow()} · {date.format("MMM D, YYYY h:mm A")}
            </Text>
          </View>
          <View className="h-px bg-divider my-5" />
          <Text className="text-text-secondary text-base leading-6">
            {message}
          </Text>
        </View>
      </View>

      {actionLabel && onAction ? (
        <View className="mt-6">
          <PrimaryButton label={actionLabel} fullWidth onPress={onAction} />
        </View>
      ) : null}
    </ScrollView>
  );
};

export default NotificationDetail;
