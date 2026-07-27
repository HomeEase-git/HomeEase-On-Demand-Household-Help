import React, { useState, useRef, useEffect } from "react";
import { View, Text, FlatList, Dimensions } from "react-native";

type Banner = { title: string; subtitle?: string; color: string };

type Props = {
  banners: Banner[];
};

const { width } = Dimensions.get("window");
const CARD_WIDTH = width - 48;
const AUTO_SCROLL_INTERVAL = 4000;

export const PromoBanner: React.FC<Props> = ({ banners }) => {
  const [index, setIndex] = useState(0);
  const ref = useRef<FlatList>(null);

  useEffect(() => {
    if (banners.length <= 1) return;
    const timer = setInterval(() => {
      setIndex((i) => {
        const next = (i + 1) % banners.length;
        ref.current?.scrollToIndex({ index: next, animated: true });
        return next;
      });
    }, AUTO_SCROLL_INTERVAL);
    return () => clearInterval(timer);
  }, [banners.length]);

  if (!banners.length) return null;

  return (
    <View className="mt-4">
      <FlatList
        ref={ref}
        data={banners}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        snapToInterval={CARD_WIDTH + 16}
        snapToAlignment="start"
        decelerationRate="fast"
        onMomentumScrollEnd={(e) => {
          const i = Math.round(
            e.nativeEvent.contentOffset.x / (CARD_WIDTH + 16),
          );
          setIndex(i);
        }}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item }) => (
          <View
            className="rounded-2xl h-40 justify-center px-6 mr-4"
            style={{ width: CARD_WIDTH, backgroundColor: item.color }}
          >
            <Text className="text-text-primary font-bold text-xl">{item.title}</Text>
            {item.subtitle && (
              <Text className="text-brand/80 text-sm mt-1">
                {item.subtitle}
              </Text>
            )}
          </View>
        )}
      />
      <View className="flex-row justify-center gap-2 mt-2">
        {banners.map((_, i) => (
          <View
            key={i}
            className={`h-1.5 rounded-full ${
              i === index ? "bg-accent w-4" : "bg-card-light w-1.5"
            }`}
          />
        ))}
      </View>
    </View>
  );
};

export default PromoBanner;
