import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, Modal, ScrollView } from "react-native";
import { TimeHHmm, isValidHHmm } from "../../utils/time";
import { colors } from "../../constants";

type Props = {
  value: TimeHHmm | null;
  onChange: (t: TimeHHmm) => void;
  disabledSlots?: TimeHHmm[];
  slots?: TimeHHmm[]; // optional override
};

function defaultSlots(): TimeHHmm[] {
  const out: TimeHHmm[] = [];
  for (let h = 8; h <= 18; h++) {
    for (const m of [0, 15, 30, 45]) {
      const hh = String(h).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      const v = `${hh}:${mm}` as TimeHHmm;
      if (isValidHHmm(v)) out.push(v);
    }
  }
  return out;
}

function parseTime(value: TimeHHmm | null): {
  hour: number;
  minute: number;
  meridiem: "AM" | "PM";
} {
  if (!value) {
    return { hour: 8, minute: 0, meridiem: "AM" };
  }

  const [rawHour, rawMinute] = value.split(":").map(Number);
  let hour = rawHour % 12;
  if (hour === 0) hour = 12;
  const minute = rawMinute;
  const meridiem = rawHour >= 12 ? "PM" : "AM";

  return { hour, minute, meridiem };
}

function to24Hour(hour: number, minute: number, meridiem: "AM" | "PM") {
  let hour24 = hour;
  if (meridiem === "PM" && hour24 < 12) hour24 += 12;
  if (meridiem === "AM" && hour24 === 12) hour24 = 0;

  return `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}` as TimeHHmm;
}

export default function TimeSlotPicker({
  value,
  onChange,
  disabledSlots = [],
  slots,
}: Props) {
  const available = useMemo(() => slots ?? defaultSlots(), [slots]);
  const [isOpen, setIsOpen] = useState(false);
  const [hour, setHour] = useState(8);
  const [minute, setMinute] = useState(0);
  const [meridiem, setMeridiem] = useState<"AM" | "PM">("AM");

  useEffect(() => {
    const parsed = parseTime(value);
    setHour(parsed.hour);
    setMinute(parsed.minute);
    setMeridiem(parsed.meridiem);
  }, [value]);

  const preview = value ? value : "Select a time";

  const confirmSelection = () => {
    const selected = to24Hour(hour, minute, meridiem);
    if (
      available.includes(selected as TimeHHmm) &&
      disabledSlots.includes(selected as TimeHHmm)
    ) {
      return;
    }
    onChange(selected);
    setIsOpen(false);
  };

  return (
    <View style={{ paddingVertical: 8 }}>
      <Pressable
        onPress={() => setIsOpen(true)}
        style={{
          borderWidth: 1,
          borderColor: colors.divider,
          borderRadius: 12,
          paddingVertical: 14,
          paddingHorizontal: 14,
          backgroundColor: colors.white,
        }}
      >
        <Text style={{ fontSize: 14, fontWeight: "600", color: colors.neutral[900] }}>
          {preview}
        </Text>
        <Text style={{ fontSize: 12, color: colors.text.secondary, marginTop: 4 }}>
          Tap to choose a time
        </Text>
      </Pressable>

      <Modal transparent visible={isOpen} animationType="slide">
        <View
          style={{
            flex: 1,
            justifyContent: "flex-end",
            backgroundColor: "rgba(0,0,0,0.45)",
          }}
        >
          <View
            style={{
              backgroundColor: colors.white,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              padding: 20,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <Text
                style={{ fontSize: 18, fontWeight: "700", color: colors.neutral[900] }}
              >
                Select time
              </Text>
              <Pressable onPress={() => setIsOpen(false)}>
                <Text style={{ color: colors.brand.DEFAULT, fontWeight: "600" }}>
                  Cancel
                </Text>
              </Pressable>
            </View>

            <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "600",
                    color: colors.text.secondary,
                    marginBottom: 6,
                  }}
                >
                  Hour
                </Text>
                <ScrollView
                  style={{ maxHeight: 180 }}
                  showsVerticalScrollIndicator={false}
                >
                  {Array.from({ length: 12 }, (_, index) => index + 1).map(
                    (value) => {
                      const selected = value === hour;
                      return (
                        <Pressable
                          key={value}
                          onPress={() => setHour(value)}
                          style={{
                            paddingVertical: 10,
                            borderRadius: 10,
                            marginBottom: 6,
                            alignItems: "center",
                            backgroundColor: selected ? colors.brand.DEFAULT : colors.card.light,
                          }}
                        >
                          <Text
                            style={{
                              color: selected ? colors.white : colors.neutral[900],
                              fontWeight: selected ? "700" : "500",
                            }}
                          >
                            {value}
                          </Text>
                        </Pressable>
                      );
                    },
                  )}
                </ScrollView>
              </View>

              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "600",
                    color: colors.text.secondary,
                    marginBottom: 6,
                  }}
                >
                  Minute
                </Text>
                <ScrollView
                  style={{ maxHeight: 180 }}
                  showsVerticalScrollIndicator={false}
                >
                  {[0, 15, 30, 45].map((value) => {
                    const selected = value === minute;
                    return (
                      <Pressable
                        key={value}
                        onPress={() => setMinute(value)}
                        style={{
                          paddingVertical: 10,
                          borderRadius: 10,
                          marginBottom: 6,
                          alignItems: "center",
                          backgroundColor: selected ? colors.brand.DEFAULT : colors.card.light,
                        }}
                      >
                        <Text
                          style={{
                            color: selected ? colors.white : colors.neutral[900],
                            fontWeight: selected ? "700" : "500",
                          }}
                        >
                          {String(value).padStart(2, "0")}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "600",
                    color: colors.text.secondary,
                    marginBottom: 6,
                  }}
                >
                  AM/PM
                </Text>
                <ScrollView
                  style={{ maxHeight: 180 }}
                  showsVerticalScrollIndicator={false}
                >
                  {["AM", "PM"].map((value) => {
                    const selected = value === meridiem;
                    return (
                      <Pressable
                        key={value}
                        onPress={() => setMeridiem(value as "AM" | "PM")}
                        style={{
                          paddingVertical: 10,
                          borderRadius: 10,
                          marginBottom: 6,
                          alignItems: "center",
                          backgroundColor: selected ? colors.brand.DEFAULT : colors.card.light,
                        }}
                      >
                        <Text
                          style={{
                            color: selected ? colors.white : colors.neutral[900],
                            fontWeight: selected ? "700" : "500",
                          }}
                        >
                          {value}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            </View>

            <Pressable
              onPress={confirmSelection}
              style={{
                borderRadius: 12,
                backgroundColor: colors.brand.DEFAULT,
                paddingVertical: 12,
                alignItems: "center",
              }}
            >
              <Text style={{ color: colors.white, fontWeight: "700" }}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
