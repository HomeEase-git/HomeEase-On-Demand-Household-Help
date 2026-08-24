import React, { useRef, useState } from "react";
import { View, Text, Pressable, Dimensions, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import Animated, {
  useSharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  interpolate,
  interpolateColor,
  Extrapolation,
  withSpring,
  SharedValue,
} from "react-native-reanimated";
import { AppIcon as Ionicons } from "../../components/icons/AppIcon";
import { colors } from "../../constants";
import {
  OnboardingWelcomeIllustration,
  OnboardingBookingIllustration,
  OnboardingTrustIllustration,
} from "../../components/illustrations/Illustrations";

const { width } = Dimensions.get("window");

const slides = [
  {
    id: "1",
    Illustration: OnboardingWelcomeIllustration,
    eyebrowIcon: "home" as const,
    eyebrow: "Welcome",
    title: "Welcome to HomeEase",
    subtitle: "Trusted help for your home, booked in just minutes.",
    tint: colors.brand.DEFAULT,
  },
  {
    id: "2",
    Illustration: OnboardingBookingIllustration,
    eyebrowIcon: "calendar" as const,
    eyebrow: "Fast Booking",
    title: "Book in Minutes",
    subtitle: "Choose a service, pick a worker, and you're all set.",
    tint: colors.accent.DEFAULT,
  },
  {
    id: "3",
    Illustration: OnboardingTrustIllustration,
    eyebrowIcon: "shield-checkmark" as const,
    eyebrow: "Verified & Safe",
    title: "Trusted Professionals",
    subtitle: "Every worker is background-checked, verified, and rated.",
    tint: colors.brand.dark,
  },
];

const SLIDE_OFFSETS = slides.map((_, i) => i * width);
const SLIDE_TINTS = slides.map((s) => s.tint);

type SlideData = (typeof slides)[number];

function Dot({
  index,
  scrollX,
  tint,
}: {
  index: number;
  scrollX: SharedValue<number>;
  tint: string;
}) {
  const inputRange = [(index - 1) * width, index * width, (index + 1) * width];
  const style = useAnimatedStyle(() => {
    const w = interpolate(scrollX.value, inputRange, [8, 24, 8], Extrapolation.CLAMP);
    const opacity = interpolate(scrollX.value, inputRange, [0.4, 1, 0.4], Extrapolation.CLAMP);
    return {
      width: w,
      opacity,
      backgroundColor: tint,
    };
  });
  return <Animated.View className="h-2 rounded-full" style={style} />;
}

function Slide({
  item,
  index,
  scrollX,
}: {
  item: SlideData;
  index: number;
  scrollX: SharedValue<number>;
}) {
  const inputRange = [(index - 1) * width, index * width, (index + 1) * width];

  const contentStyle = useAnimatedStyle(() => {
    const opacity = interpolate(scrollX.value, inputRange, [0, 1, 0], Extrapolation.CLAMP);
    const translateY = interpolate(scrollX.value, inputRange, [24, 0, 24], Extrapolation.CLAMP);
    return { opacity, transform: [{ translateY }] };
  });

  const illustrationStyle = useAnimatedStyle(() => {
    const scale = interpolate(scrollX.value, inputRange, [0.8, 1, 0.8], Extrapolation.CLAMP);
    return { transform: [{ scale }] };
  });

  return (
    <View style={{ width }} className="flex-1 px-8 justify-center items-center">
      <Animated.View style={illustrationStyle} className="mb-10">
        <View
          style={[
            styles.glow,
            { backgroundColor: item.tint, width: 260, height: 260, borderRadius: 130 },
          ]}
        />
        <item.Illustration size={220} />
      </Animated.View>

      <Animated.View style={contentStyle} className="items-center">
        <View
          className="flex-row items-center gap-1.5 rounded-full px-3 py-1.5 mb-4"
          style={{ backgroundColor: item.tint + "1A" }}
        >
          <Ionicons name={item.eyebrowIcon} size={14} color={item.tint} />
          <Text className="font-semibold text-xs" style={{ color: item.tint }}>
            {item.eyebrow.toUpperCase()}
          </Text>
        </View>

        <Text className="text-text-primary text-3xl font-bold text-center">
          {item.title}
        </Text>
        <Text className="text-text-secondary text-center text-base mt-3 leading-6 px-2">
          {item.subtitle}
        </Text>
      </Animated.View>
    </View>
  );
}

function CtaButton({ label, onPress }: { label: string; onPress: () => void }) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={style}>
      <Pressable
        className="bg-brand rounded-xl py-4 px-6 flex-row items-center justify-center gap-2"
        onPressIn={() => {
          // eslint-disable-next-line react-hooks/immutability -- Reanimated shared value mutation is the intended API
          scale.value = withSpring(0.96, { damping: 15, stiffness: 300 });
        }}
        onPressOut={() => {
          // eslint-disable-next-line react-hooks/immutability -- Reanimated shared value mutation is the intended API
          scale.value = withSpring(1, { damping: 15, stiffness: 300 });
        }}
        onPress={onPress}
      >
        <Text className="text-white font-semibold text-base">{label}</Text>
        <Ionicons name="arrow-forward" size={18} color={colors.white} />
      </Pressable>
    </Animated.View>
  );
}

export default function OnboardingScreen() {
  const router = useRouter();
  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollX = useSharedValue(0);
  const flatListRef = useRef<Animated.FlatList<SlideData>>(null);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollX.value = e.contentOffset.x;
    },
  });

  const onMomentumScrollEnd = (offsetX: number) => {
    setCurrentIndex(Math.round(offsetX / width));
  };

  const finish = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.replace("/role-selection");
  };

  const onNext = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (currentIndex < slides.length - 1) {
      const next = currentIndex + 1;
      flatListRef.current?.scrollToOffset({ offset: next * width, animated: true });
      setCurrentIndex(next);
    } else {
      finish();
    }
  };

  const blobStyle = useAnimatedStyle(() => {
    const color = interpolateColor(scrollX.value, SLIDE_OFFSETS, SLIDE_TINTS);
    return { backgroundColor: color };
  });

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Animated.View style={[styles.blobTop, blobStyle]} />
        <Animated.View style={[styles.blobBottom, blobStyle]} />
      </View>

      <View className="flex-row justify-between items-center px-6 pt-4">
        <View className="flex-row gap-1.5">
          {slides.map((s, i) => (
            <Dot key={s.id} index={i} scrollX={scrollX} tint={s.tint} />
          ))}
        </View>
        <Pressable
          className="py-2 px-4 rounded-full bg-card-light"
          onPress={finish}
          hitSlop={8}
        >
          <Text className="text-text-secondary font-semibold">Skip</Text>
        </Pressable>
      </View>

      <Animated.FlatList
        ref={flatListRef}
        data={slides}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        onMomentumScrollEnd={(e) => onMomentumScrollEnd(e.nativeEvent.contentOffset.x)}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <Slide item={item} index={index} scrollX={scrollX} />
        )}
      />

      <View className="px-6 pb-8 pt-2">
        <CtaButton
          label={currentIndex === slides.length - 1 ? "Get Started" : "Next"}
          onPress={onNext}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  blobTop: {
    position: "absolute",
    top: -90,
    right: -90,
    width: width * 0.85,
    height: width * 0.85,
    borderRadius: width,
    opacity: 0.1,
  },
  blobBottom: {
    position: "absolute",
    bottom: -100,
    left: -110,
    width: width * 0.7,
    height: width * 0.7,
    borderRadius: width,
    opacity: 0.08,
  },
  glow: {
    position: "absolute",
    alignSelf: "center",
    top: -20,
    opacity: 0.14,
  },
});
