import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, PanResponder, type LayoutChangeEvent } from "react-native";
import { colors } from "../../constants";

const MIN_RATE = 20;
const MAX_RATE = 100;
const THUMB_SIZE = 28;

type Props = {
  value: number;
  onChange: (value: number) => void;
};

/**
 * ₱20-₱100/hr drag slider. Hand-rolled with PanResponder (no
 * @react-native-community/slider dependency in this project) — snaps to
 * whole-peso steps.
 */
export default function HourlyRateSlider({ value, onChange }: Props) {
  const [trackWidth, setTrackWidth] = useState(0);
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const clamp = (n: number) => Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(n)));

  const positionForValue = (v: number) => {
    if (trackWidth <= 0) return 0;
    const ratio = (v - MIN_RATE) / (MAX_RATE - MIN_RATE);
    return ratio * (trackWidth - THUMB_SIZE);
  };

  const valueForPosition = (x: number) => {
    if (trackWidth <= 0) return MIN_RATE;
    const ratio = Math.min(1, Math.max(0, x / (trackWidth - THUMB_SIZE)));
    return clamp(MIN_RATE + ratio * (MAX_RATE - MIN_RATE));
  };

  const panResponder = useMemo(
    () =>
      // The linter flags this closure for reading valueRef.current, but that
      // read only ever executes inside onPanResponderMove/onPanResponderGrant
      // — real gesture callbacks, never during render — so it's a false
      // positive for this standard React Native PanResponder pattern.
      // eslint-disable-next-line react-hooks/refs
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderMove: (_evt, gesture) => {
          const startX = positionForValue(valueRef.current);
          onChange(valueForPosition(startX + gesture.dx));
        },
        onPanResponderGrant: (evt) => {
          onChange(valueForPosition(evt.nativeEvent.locationX - THUMB_SIZE / 2));
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trackWidth],
  );

  const handleLayout = (e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width);
  const thumbLeft = positionForValue(value);
  const fillWidth = thumbLeft + THUMB_SIZE / 2;

  return (
    <View>
      <View className="items-center mb-4">
        <Text className="text-accent font-bold text-4xl">₱{value}</Text>
        <Text className="text-text-muted text-xs mt-1">per hour</Text>
      </View>

      <View onLayout={handleLayout} className="h-9 justify-center" {...panResponder.panHandlers}>
        <View className="h-2 rounded-full bg-card-dark overflow-hidden">
          <View style={{ width: fillWidth, height: "100%", backgroundColor: colors.accent.DEFAULT }} />
        </View>
        <View
          style={{
            position: "absolute",
            left: thumbLeft,
            width: THUMB_SIZE,
            height: THUMB_SIZE,
            borderRadius: THUMB_SIZE / 2,
            backgroundColor: colors.white,
            borderWidth: 3,
            borderColor: colors.accent.DEFAULT,
            shadowColor: "#000",
            shadowOpacity: 0.2,
            shadowRadius: 3,
            shadowOffset: { width: 0, height: 1 },
            elevation: 3,
          }}
        />
      </View>

      <View className="flex-row justify-between mt-2">
        <Text className="text-text-muted text-xs">₱{MIN_RATE}/hr</Text>
        <Text className="text-text-muted text-xs">₱{MAX_RATE}/hr</Text>
      </View>
    </View>
  );
}
