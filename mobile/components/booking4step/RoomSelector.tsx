import React from "react";
import { View, Text, Pressable } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { colors } from "../../constants";
import { ROOM_TYPES, ROOM_TYPE_LABELS, type RoomType, type RoomSelection } from "../../types/booking4step.types";

const MAX_COUNT_PER_ROOM = 9;

type Props = {
  selection: RoomSelection[];
  onChange: (selection: RoomSelection[]) => void;
};

/**
 * Multi-select room chips with a +/- item-count badge per selected room
 * (e.g. "Bedroom x2"). Tapping an unselected chip adds it with count 1;
 * tapping again removes it. Count only adjusts via the +/- controls that
 * appear once a chip is selected.
 */
export default function RoomSelector({ selection, onChange }: Props) {
  const countFor = (room: RoomType) => selection.find((s) => s.room === room)?.count ?? 0;

  const toggle = (room: RoomType) => {
    const existing = selection.find((s) => s.room === room);
    if (existing) {
      onChange(selection.filter((s) => s.room !== room));
    } else {
      onChange([...selection, { room, count: 1 }]);
    }
  };

  const adjust = (room: RoomType, delta: number) => {
    onChange(
      selection
        .map((s) => (s.room === room ? { ...s, count: Math.max(1, Math.min(MAX_COUNT_PER_ROOM, s.count + delta)) } : s))
        .filter((s) => s.count > 0)
    );
  };

  return (
    <View className="flex-row flex-wrap gap-2">
      {ROOM_TYPES.map((room) => {
        const count = countFor(room);
        const isSelected = count > 0;

        if (isSelected) {
          return (
            <View
              key={room}
              className="flex-row items-center bg-accent rounded-full pl-3 pr-1.5 py-1.5"
            >
              <Text className="text-white font-semibold text-sm mr-2">{ROOM_TYPE_LABELS[room]}</Text>
              <Pressable
                accessibilityLabel={`Decrease ${ROOM_TYPE_LABELS[room]} count`}
                onPress={() => adjust(room, -1)}
                className="w-6 h-6 rounded-full bg-white/25 items-center justify-center"
              >
                <Ionicons name="remove" size={14} color={colors.white} />
              </Pressable>
              <Text className="text-white font-bold text-sm mx-1.5 min-w-[14px] text-center">{count}</Text>
              <Pressable
                accessibilityLabel={`Increase ${ROOM_TYPE_LABELS[room]} count`}
                onPress={() => adjust(room, 1)}
                className="w-6 h-6 rounded-full bg-white/25 items-center justify-center"
              >
                <Ionicons name="add" size={14} color={colors.white} />
              </Pressable>
              <Pressable
                accessibilityLabel={`Remove ${ROOM_TYPE_LABELS[room]}`}
                onPress={() => toggle(room)}
                className="ml-1.5 w-6 h-6 items-center justify-center"
              >
                <Ionicons name="close" size={14} color={colors.white} />
              </Pressable>
            </View>
          );
        }

        return (
          <Pressable
            key={room}
            accessibilityRole="button"
            onPress={() => toggle(room)}
            className="bg-card rounded-full px-4 py-2.5 border border-divider"
          >
            <Text className="text-text-secondary font-medium text-sm">{ROOM_TYPE_LABELS[room]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
