import React, { useState, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import PrimaryButton from "../../components/ui/PrimaryButton";
import { colors } from "../../constants";

const { width } = Dimensions.get("window");

const slides = [
  {
    id: "1",
    icon: "home" as const,
    iconColor: colors.brand.DEFAULT,
    title: "Welcome to HomeEase",
    subtitle: "Your home, our care.",
  },
  {
    id: "2",
    icon: "calendar" as const,
    iconColor: colors.brand.DEFAULT,
    title: "Book in Minutes",
    subtitle: "Choose a service, pick a worker, done.",
  },
  {
    id: "3",
    icon: "shield-checkmark" as const,
    iconColor: colors.brand.DEFAULT,
    title: "Trusted Professionals",
    subtitle: "All workers are verified and rated.",
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = e.nativeEvent.contentOffset.x;
    const index = Math.round(offset / width);
    setCurrentIndex(index);
  };

  const onNext = () => {
    if (currentIndex < slides.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1 });
    } else {
      router.replace({
        pathname: "/role-selection",
        params: { intent: "signup" },
      });
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <Pressable
        className="absolute top-10 right-4 z-10 py-2 px-3"
        onPress={() => router.replace("/role-selection?intent=signup")}
      >
        <Text className="text-accent font-bold">Skip</Text>
      </Pressable>

      <FlatList
        ref={flatListRef}
        data={slides}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View
            style={{ width }}
            className="flex-1 px-8 justify-center items-center"
          >
            {/* TODO: Replace with contextual illustration */}
            <View className="w-64 h-64 bg-card-dark rounded-full items-center justify-center mb-8">
              <Ionicons name={item.icon} size={100} color={item.iconColor} />
            </View>
            <Text className="text-accent text-3xl font-bold text-center">
              {item.title}
            </Text>
            <Text className="text-accent text-center text-lg mt-3">
              {item.subtitle}
            </Text>
          </View>
        )}
      />

      <View className="flex-row justify-center gap-2 mb-6">
        {slides.map((_, index) => (
          <View
            key={index}
            className={`w-2 h-2 rounded-full ${
              index === currentIndex ? "bg-accent w-6" : "bg-card-light"
            }`}
          />
        ))}
      </View>

      <View className="px-6 pb-8">
        <PrimaryButton
          label={currentIndex === slides.length - 1 ? "Get Started" : "Next"}
          fullWidth
          onPress={onNext}
        />
      </View>
    </SafeAreaView>
  );
}
