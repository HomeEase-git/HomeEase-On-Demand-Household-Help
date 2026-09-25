import React from "react";
import { View, Text } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { colors } from "../../constants";
import { TIMELINE_STEPS, type BookingTimeline, type TimelineTone } from "../../utils/bookingTimeline";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

const TONE: Record<TimelineTone, { card: string; accent: string; icon: IconName; iconColor: string }> = {
  normal: { card: "bg-brand/5 border-brand/20", accent: colors.brand.DEFAULT, icon: "time-outline", iconColor: colors.brand.DEFAULT },
  action: { card: "bg-accent/10 border-accent/40", accent: colors.accent.DEFAULT, icon: "alert-circle", iconColor: colors.accent.DEFAULT },
  issue: { card: "bg-error/5 border-error/30", accent: colors.error, icon: "shield-half-outline", iconColor: colors.error },
  stopped: { card: "bg-card border-divider", accent: colors.text.muted, icon: "close-circle", iconColor: colors.error },
};

/**
 * Top-of-screen summary of where a booking is: a headline, one line of
 * detail, and a five-step progress bar. See utils/bookingTimeline.ts.
 */
export const BookingStatusHero: React.FC<{ timeline: BookingTimeline }> = ({ timeline }) => {
  const tone = TONE[timeline.tone];
  const allDone = timeline.current >= TIMELINE_STEPS.length;
  const stopped = timeline.tone === "stopped";

  return (
    <View className={`rounded-2xl border p-4 mb-3 ${tone.card}`}>
      <View className="flex-row items-start">
        <Ionicons
          name={allDone ? "checkmark-circle" : tone.icon}
          size={24}
          color={allDone ? colors.success : tone.iconColor}
        />
        <View className="flex-1 ml-3">
          <Text className="text-text-primary text-lg font-bold">{timeline.headline}</Text>
          {!!timeline.detail && (
            <Text className="text-text-secondary text-sm mt-0.5">{timeline.detail}</Text>
          )}
        </View>
      </View>

      <View
        className="flex-row mt-4"
        accessible
        accessibilityLabel={
          stopped
            ? "Booking stopped"
            : allDone
              ? "All steps complete"
              : `Step ${timeline.current + 1} of ${TIMELINE_STEPS.length}: ${TIMELINE_STEPS[timeline.current]}`
        }
      >
        {TIMELINE_STEPS.map((label, index) => {
          const done = !stopped && (allDone || index < timeline.current);
          const active = !stopped && !allDone && index === timeline.current;
          return (
            <View key={label} className="flex-1 items-center">
              <View className="flex-row items-center w-full">
                {/* connector into this dot */}
                <View
                  className={`flex-1 h-0.5 ${index === 0 ? "opacity-0" : ""}`}
                  style={{ backgroundColor: done || active ? tone.accent : colors.divider }}
                />
                <View
                  className="w-5 h-5 rounded-full items-center justify-center"
                  style={{
                    backgroundColor: done ? tone.accent : colors.white,
                    borderWidth: 2,
                    borderColor: done || active ? tone.accent : colors.divider,
                  }}
                >
                  {done && <Ionicons name="checkmark" size={12} color={colors.white} />}
                  {active && <View className="w-2 h-2 rounded-full" style={{ backgroundColor: tone.accent }} />}
                </View>
                <View
                  className={`flex-1 h-0.5 ${index === TIMELINE_STEPS.length - 1 ? "opacity-0" : ""}`}
                  style={{ backgroundColor: done && (allDone || index + 1 < timeline.current + 1) ? tone.accent : colors.divider }}
                />
              </View>
              <Text
                className={`text-xs mt-1.5 text-center ${
                  active ? "text-text-primary font-semibold" : done ? "text-text-secondary" : "text-text-muted"
                }`}
                numberOfLines={2}
              >
                {label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
};

export default BookingStatusHero;
