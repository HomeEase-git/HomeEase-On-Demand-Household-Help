import React from "react";
import { View, Text } from "react-native";
import type { DayEarnings } from "../../utils/workerHome";

const BAR_MAX_HEIGHT = 96;
const peso = (n: number) => `₱${Math.round(n).toLocaleString("en-PH")}`;

/** Seven bars, one per day ending today, scaled to the best day. */
export const WeeklyEarningsChart: React.FC<{ days: DayEarnings[] }> = ({ days }) => {
  const max = Math.max(...days.map((d) => d.total), 0);
  const weekTotal = days.reduce((sum, d) => sum + d.total, 0);

  return (
    <View className="bg-card rounded-2xl p-5 mx-4 mt-4">
      <View className="flex-row items-baseline justify-between">
        <Text className="text-text-primary font-bold">This week</Text>
        <Text className="text-text-primary font-bold text-lg">{peso(weekTotal)}</Text>
      </View>
      <Text className="text-text-muted text-xs">Completed jobs, last 7 days</Text>

      <View
        className="flex-row items-end justify-between mt-4"
        style={{ height: BAR_MAX_HEIGHT + 36 }}
        accessible
        accessibilityLabel={`Earnings this week: ${days.map((d) => `${d.label} ${peso(d.total)}`).join(", ")}`}
      >
        {days.map((day) => {
          const height = max > 0 ? Math.max(4, (day.total / max) * BAR_MAX_HEIGHT) : 4;
          return (
            <View key={day.key} className="flex-1 items-center">
              {day.total > 0 && (
                <Text className="text-text-secondary text-xs mb-1" numberOfLines={1}>
                  {day.total >= 1000 ? `${Math.round(day.total / 100) / 10}k` : Math.round(day.total)}
                </Text>
              )}
              <View
                className={`w-5 rounded-md ${day.isToday ? "bg-brand" : day.total > 0 ? "bg-brand/40" : "bg-divider"}`}
                style={{ height }}
              />
              <Text className={`text-xs mt-1.5 ${day.isToday ? "text-text-primary font-semibold" : "text-text-muted"}`}>
                {day.label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
};

export default WeeklyEarningsChart;
