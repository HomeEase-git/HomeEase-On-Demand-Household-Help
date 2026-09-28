import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../constants";
import {
  FIRST_START_TIME,
  LAST_START_TIME,
  formatTime12h,
  minutesToTime,
  timeToMinutes,
} from "../../utils/bookingTime";

type Period = "AM" | "PM";

type Props = {
  value: string | null;
  // "HH:mm" (24h) when the entry is a complete, allowed time; null otherwise.
  onChange: (time: string | null) => void;
  // Earliest allowed "HH:mm" (e.g. later for a same-day booking); null when
  // no time is left on that day. Defaults to FIRST_START_TIME.
  minTime?: string | null;
  // Start times already taken on that day (e.g. the pro's other jobs) —
  // still pickable, just listed as a heads-up.
  busyTimes?: string[];
};

const MINUTE_STEP = 5;

function parts(time: string): { hour: string; minute: string; period: Period } {
  const [h, m] = time.split(":").map(Number);
  return { hour: String(h % 12 === 0 ? 12 : h % 12), minute: String(m).padStart(2, "0"), period: h >= 12 ? "PM" : "AM" };
}

function to24h(hourText: string, minuteText: string, period: Period): string | null {
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!/^\d{1,2}$/.test(hourText) || !/^\d{1,2}$/.test(minuteText)) return null;
  if (hour < 1 || hour > 12 || minute > 59) return null;
  return minutesToTime(((hour % 12) + (period === "PM" ? 12 : 0)) * 60 + minute);
}

// Service hours run 7 AM – 6 PM, so a typed 7–11 means morning and 12, 1–6 afternoon.
function likelyPeriod(hourText: string): Period {
  const hour = Number(hourText);
  return hour >= 7 && hour <= 11 ? "AM" : "PM";
}

/**
 * 12-hour start-time entry: type or step the hour and minutes, then pick
 * AM/PM. Only emits a time inside [minTime, LAST_START_TIME]
 * (see utils/bookingTime.ts); anything else shows why and emits null.
 */
export default function StartTimePicker({ value, onChange, minTime = FIRST_START_TIME, busyTimes = [] }: Props) {
  const initial = value ? parts(value) : null;
  const [hour, setHour] = useState(initial?.hour ?? "");
  const [minute, setMinute] = useState(initial?.minute ?? "");
  const [period, setPeriod] = useState<Period>(initial?.period ?? "AM");
  // Until the user taps AM/PM, guess it from the hour they enter.
  const periodChosen = useRef(!!initial);
  const lastEmitted = useRef<string | null>(value);

  // Take on a time set from outside (e.g. a restored draft).
  useEffect(() => {
    if (value && value !== lastEmitted.current) {
      const p = parts(value);
      setHour(p.hour);
      setMinute(p.minute);
      setPeriod(p.period);
      periodChosen.current = true;
      lastEmitted.current = value;
    }
  }, [value]);

  const entered = to24h(hour, minute, period);
  const tooEarly = !!entered && !!minTime && timeToMinutes(entered) < timeToMinutes(minTime);
  const tooLate = !!entered && timeToMinutes(entered) > timeToMinutes(LAST_START_TIME);
  const valid = !!entered && !!minTime && !tooEarly && !tooLate ? entered : null;

  // Report the (re)validated time — also when minTime moves, e.g. a new date.
  useEffect(() => {
    if (valid !== lastEmitted.current) {
      lastEmitted.current = valid;
      onChange(valid);
    }
  }, [valid, onChange]);

  const changeHour = (text: string) => {
    const digits = text.replace(/\D/g, "").slice(0, 2);
    setHour(digits);
    if (!periodChosen.current && digits) setPeriod(likelyPeriod(digits));
  };

  const changeMinute = (text: string) => setMinute(text.replace(/\D/g, "").slice(0, 2));

  const stepHour = (delta: number) => {
    const current = Number(hour);
    const start = minTime ? parts(minTime) : parts(FIRST_START_TIME);
    const next = hour && current >= 1 && current <= 12 ? ((current - 1 + delta + 12) % 12) + 1 : Number(start.hour);
    changeHour(String(next));
    if (!minute) setMinute("00");
  };

  const stepMinute = (delta: number) => {
    const current = Number(minute);
    // Snap to the next/previous multiple of MINUTE_STEP, wrapping within the hour.
    const snapped = delta > 0 ? Math.floor(current / MINUTE_STEP) * MINUTE_STEP : Math.ceil(current / MINUTE_STEP) * MINUTE_STEP;
    const next = minute === "" || current > 59 ? 0 : (snapped + delta + 60) % 60;
    setMinute(String(next).padStart(2, "0"));
  };

  const choosePeriod = (p: Period) => {
    periodChosen.current = true;
    setPeriod(p);
  };

  const incomplete = hour === "" || minute === "";
  let message: { text: string; tone: "muted" | "error" | "ok" };
  if (!minTime) {
    message = { text: "No start times are left on this day. Pick another date.", tone: "error" };
  } else if (incomplete) {
    message = { text: `Between ${formatTime12h(minTime)} and ${formatTime12h(LAST_START_TIME)}`, tone: "muted" };
  } else if (!entered) {
    message = { text: "Enter an hour from 1 to 12 and minutes from 00 to 59.", tone: "error" };
  } else if (tooEarly) {
    message = {
      text:
        minTime === FIRST_START_TIME
          ? `Pros start at ${formatTime12h(FIRST_START_TIME)} at the earliest.`
          : `The earliest start on this day is ${formatTime12h(minTime)}.`,
      tone: "error",
    };
  } else if (tooLate) {
    message = { text: `The latest start is ${formatTime12h(LAST_START_TIME)}.`, tone: "error" };
  } else {
    message = { text: `Starts at ${formatTime12h(entered)}`, tone: "ok" };
  }

  const clash = valid && busyTimes.includes(valid);

  return (
    <View>
      <View className="flex-row items-center justify-center bg-card rounded-2xl py-3 px-2">
        <Field
          label="Hour"
          value={hour}
          placeholder="--"
          onChangeText={changeHour}
          onStep={stepHour}
          disabled={!minTime}
        />
        <Text className="text-text-primary text-3xl font-bold mx-1">:</Text>
        <Field
          label="Minutes"
          value={minute}
          placeholder="--"
          onChangeText={changeMinute}
          onBlur={() => minute.length === 1 && setMinute(minute.padStart(2, "0"))}
          onStep={stepMinute}
          disabled={!minTime}
        />
        <View className="ml-4 rounded-xl overflow-hidden border-2 border-accent" accessibilityRole="radiogroup">
          {(["AM", "PM"] as const).map((p) => {
            const selected = period === p;
            return (
              <Pressable
                key={p}
                disabled={!minTime}
                onPress={() => choosePeriod(p)}
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled: !minTime }}
                accessibilityLabel={p}
                className={`px-4 py-2.5 ${selected ? "bg-accent" : "bg-white"}`}
              >
                <Text className={`font-bold ${selected ? "text-white" : "text-text-primary"}`}>{p}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Text
        className={`text-xs mt-2 ${
          message.tone === "error" ? "text-error" : message.tone === "ok" ? "text-success" : "text-text-muted"
        }`}
      >
        {message.text}
      </Text>

      {busyTimes.length > 0 && (
        <Text className={`text-xs mt-1 ${clash ? "text-warning" : "text-text-muted"}`}>
          {clash
            ? "Your pro already has another job at this time."
            : `Your pro has other jobs at ${busyTimes.map((t) => formatTime12h(t)).join(", ")} on this day.`}
        </Text>
      )}
    </View>
  );
}

function Field({
  label,
  value,
  placeholder,
  onChangeText,
  onBlur,
  onStep,
  disabled,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChangeText: (text: string) => void;
  onBlur?: () => void;
  onStep: (delta: number) => void;
  disabled: boolean;
}) {
  const step = label === "Minutes" ? MINUTE_STEP : 1;
  return (
    <View className={`items-center ${disabled ? "opacity-30" : ""}`}>
      <Pressable
        onPress={() => onStep(step)}
        disabled={disabled}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Increase ${label.toLowerCase()}`}
        className="p-1"
      >
        <Ionicons name="chevron-up" size={22} color={colors.accent.DEFAULT} />
      </Pressable>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        editable={!disabled}
        placeholder={placeholder}
        placeholderTextColor={colors.text.muted}
        keyboardType="number-pad"
        maxLength={2}
        selectTextOnFocus
        accessibilityLabel={label}
        className="bg-white rounded-xl text-text-primary text-3xl font-bold text-center"
        style={{ width: 64, paddingVertical: 6 }}
      />
      <Pressable
        onPress={() => onStep(-step)}
        disabled={disabled}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${label.toLowerCase()}`}
        className="p-1"
      >
        <Ionicons name="chevron-down" size={22} color={colors.accent.DEFAULT} />
      </Pressable>
      <Text className="text-text-muted text-[10px]">{label}</Text>
    </View>
  );
}
