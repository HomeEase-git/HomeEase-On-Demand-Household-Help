import React, { useCallback, useState } from "react";
import { View, Text, Image, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { AppIcon as Ionicons } from "../../../components/icons/AppIcon";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import StarRating from "../../../components/ui/StarRating";
import { buildDigitalIdCard } from "../../../utils/digitalId";
import * as api from "../../../services/api";
import type { WorkerDigitalId } from "../../../types/api.types";
import { colors, cardShadow } from "../../../constants";

export default function DigitalIdScreen() {
  const [data, setData] = useState<WorkerDigitalId | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      setError(false);
      api
        .getMyDigitalId()
        .then((result) => {
          if (active) setData(result);
        })
        .catch((err) => {
          console.error("Load digital ID error:", err);
          if (active) setError(true);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, []),
  );

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Digital ID" showBack />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.accent.DEFAULT} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !data) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Digital ID" showBack />
        <ScrollView contentContainerStyle={{ padding: 24 }}>
          <View className="bg-card-light rounded-2xl p-6 items-center" style={cardShadow}>
            <Text className="text-text-primary font-semibold text-lg mb-2">
              Couldn&apos;t load your Digital ID
            </Text>
            <Text className="text-text-secondary text-sm text-center">
              Please try again in a moment.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const card = buildDigitalIdCard({
    name: data.name,
    avatar: data.avatar,
    badgeId: data.badgeId,
    verified: data.verified,
    rating: data.rating,
    totalReviews: data.totalReviews,
    trade: data.trade ?? undefined,
    serviceArea: data.serviceArea ?? undefined,
    licenseNumber: data.licenseNumber ?? undefined,
  });

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Digital ID" showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <View className="bg-brand rounded-3xl p-6" style={cardShadow}>
          <View className="flex-row items-center">
            <View className="w-16 h-16 rounded-full bg-white/20 items-center justify-center overflow-hidden mr-4">
              {card.avatar ? (
                <Image
                  source={{ uri: card.avatar }}
                  style={{ width: 64, height: 64 }}
                  resizeMode="cover"
                />
              ) : (
                <Ionicons name="person" size={32} color={colors.white} />
              )}
            </View>
            <View className="flex-1">
              <Text className="text-white text-xl font-bold">
                {card.fullName}
              </Text>
              <Text className="text-white/70 text-xs mt-0.5">
                {card.badgeId}
              </Text>
              <View className="flex-row items-center mt-1">
                <StarRating rating={card.rating} size={14} />
                <Text className="text-white/70 text-xs ml-2">
                  {card.totalReviews} review{card.totalReviews !== 1 ? "s" : ""}
                </Text>
              </View>
            </View>
          </View>

          <View
            className="flex-row items-center mt-5 rounded-2xl p-3"
            style={{
              backgroundColor: card.verified
                ? `${colors.success}30`
                : `${colors.warning}30`,
            }}
          >
            <Ionicons
              name={card.verified ? "checkmark-circle" : "time-outline"}
              size={18}
              color={card.verified ? colors.success : colors.warning}
            />
            <Text
              className="font-semibold text-sm ml-2"
              style={{ color: card.verified ? colors.success : colors.warning }}
            >
              {card.verificationLabel}
            </Text>
          </View>

          {card.trade && (
            <View className="mt-3 bg-white/15 rounded-2xl p-4">
              <Text className="text-white text-sm">Trade</Text>
              <Text className="text-white font-semibold text-lg">
                {card.trade}
              </Text>
            </View>
          )}

          {card.serviceArea && (
            <View className="mt-3 bg-white/15 rounded-2xl p-4">
              <Text className="text-white text-sm">Service Area</Text>
              <Text className="text-white font-semibold text-lg">
                {card.serviceArea}
              </Text>
            </View>
          )}

          {card.licenseNumber && (
            <View className="mt-3 bg-white/15 rounded-2xl p-4">
              <Text className="text-white text-sm">License / Registration</Text>
              <Text className="text-white font-semibold text-lg">
                {card.licenseNumber}
              </Text>
            </View>
          )}
        </View>

        <View className="bg-card-light rounded-2xl p-4 mt-6" style={cardShadow}>
          <Text className="text-text-primary font-semibold mb-2">How to use it</Text>
          <Text className="text-text-secondary text-sm">
            Show this card to clients before starting work. Ask them to
            compare your photo and name here against the worker shown on
            their booking screen to confirm your identity.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
