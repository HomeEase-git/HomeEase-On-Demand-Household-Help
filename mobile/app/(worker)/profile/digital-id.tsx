import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  Image,
  ScrollView,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import Svg, { Rect, Line } from "react-native-svg";
import QRCode from "react-native-qrcode-svg";
import { AppIcon as Ionicons } from "../../../components/icons/AppIcon";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import { buildDigitalIdCard } from "../../../utils/digitalId";
import * as api from "../../../services/api";
import type { WorkerDigitalId } from "../../../types/api.types";
import { colors, cardShadow, config } from "../../../constants";

/** Uppercase micro-label above each value on the card. */
function FieldLabel({
  children,
  hint,
  onDark,
}: {
  children: string;
  hint?: string;
  onDark?: boolean;
}) {
  return (
    <Text
      style={{
        fontSize: 10,
        letterSpacing: 1,
        fontWeight: "700",
        color: onDark ? "rgba(255,255,255,0.55)" : colors.neutral[400],
      }}
    >
      {children}
      {hint ? (
        <Text style={{ fontWeight: "400", letterSpacing: 0 }}> {hint}</Text>
      ) : null}
    </Text>
  );
}

/** Two-tone diagonal stripe bar that caps the back of the card. */
function StripeBar({ width }: { width: number }) {
  const H = 14;
  const step = 15;
  const lines: React.ReactNode[] = [];
  for (let x = -H; x < width + H; x += step) {
    lines.push(
      <Line
        key={x}
        x1={x}
        y1={-2}
        x2={x - (H + 4)}
        y2={H + 2}
        stroke={colors.brand.DEFAULT}
        strokeWidth={8}
      />,
    );
  }
  return (
    <Svg width={width} height={H}>
      <Rect x={0} y={0} width={width} height={H} fill={colors.brand.dark} />
      {lines}
    </Svg>
  );
}

export default function DigitalIdScreen() {
  const [data, setData] = useState<WorkerDigitalId | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const { width } = useWindowDimensions();
  const cardWidth = width - 48; // screen has 24px horizontal padding

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
          <View
            className="bg-card-light rounded-2xl p-6 items-center"
            style={cardShadow}
          >
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
    id: data.id,
    name: data.name,
    avatar: data.avatar,
    badgeId: data.badgeId,
    verified: data.verified,
    rating: data.rating,
    totalReviews: data.totalReviews,
    trade: data.trade ?? undefined,
    serviceArea: data.serviceArea ?? undefined,
    licenseNumber: data.licenseNumber ?? undefined,
    memberSince: data.memberSince,
    kycApprovedAt: data.kycApprovedAt,
    verificationBaseUrl: config.API_URL,
  });

  const accent = card.verified ? colors.success : colors.warning;
  const mono = { fontFamily: "monospace" as const };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Digital ID" showBack />
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
        {/* ---------- FRONT ---------- */}
        <View
          className="bg-brand rounded-3xl overflow-hidden"
          style={cardShadow}
        >
          {/* faint background flourishes */}
          <View
            pointerEvents="none"
            className="absolute rounded-full bg-white/5"
            style={{ width: 220, height: 220, top: -70, right: -60 }}
          />
          <View
            pointerEvents="none"
            className="absolute rounded-full bg-white/5"
            style={{ width: 140, height: 140, bottom: 30, left: -50 }}
          />

          <View className="p-6">
            {/* brand row */}
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center">
                <View className="w-7 h-7 rounded-lg bg-white/25 mr-2" />
                <Text className="text-white text-base font-bold">HomeEase</Text>
              </View>
              <Text
                style={{
                  color: "rgba(255,255,255,0.55)",
                  fontSize: 11,
                  letterSpacing: 2,
                  fontWeight: "700",
                }}
              >
                WORKER ID
              </Text>
            </View>

            {/* photo + identity */}
            <View className="flex-row mt-5">
              <View className="w-[86px] h-[86px] rounded-2xl bg-white/15 border border-white/20 items-center justify-center overflow-hidden mr-4">
                {card.avatar ? (
                  <Image
                    source={{ uri: card.avatar }}
                    style={{ width: 86, height: 86 }}
                    resizeMode="cover"
                  />
                ) : (
                  <Ionicons name="person" size={34} color={colors.white} />
                )}
              </View>

              <View className="flex-1 justify-center">
                <Text
                  className="text-white text-[22px] font-bold"
                  numberOfLines={1}
                >
                  {card.fullName}
                </Text>

                <View className="flex-row mt-3">
                  <View className="flex-1">
                    <FieldLabel onDark>ID NUMBER</FieldLabel>
                    <Text
                      className="text-white text-sm mt-0.5"
                      style={mono}
                    >
                      {card.badgeId}
                    </Text>
                  </View>
                  <View className="flex-1">
                    <FieldLabel onDark>MEMBER SINCE</FieldLabel>
                    <Text className="text-white text-sm font-medium mt-0.5">
                      {card.memberSinceLabel}
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            {/* trade */}
            <View className="mt-4">
              <FieldLabel onDark hint="(self-reported)">
                TRADE
              </FieldLabel>
              <Text className="text-white text-base font-semibold mt-0.5">
                {card.trade || "Not provided"}
              </Text>
            </View>

            {/* footer */}
            <View className="h-px bg-white/15 mt-5" />
            <View className="flex-row items-center justify-between mt-3">
              <View className="flex-row items-center">
                <Ionicons
                  name={card.verified ? "checkmark-circle" : "time-outline"}
                  size={15}
                  color={accent}
                />
                <Text
                  className="text-[13px] font-semibold ml-1.5"
                  style={{ color: accent }}
                >
                  {card.verificationLabel}
                </Text>
              </View>
              <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
                Flip for live verification →
              </Text>
            </View>
          </View>
        </View>

        {/* ---------- BACK ---------- */}
        <View
          className="bg-white rounded-3xl overflow-hidden mt-4 border border-neutral-200"
          style={cardShadow}
        >
          <StripeBar width={cardWidth} />

          <View className="p-6">
            <View className="flex-row">
              <View className="flex-1 pr-3">
                <FieldLabel>SERVICE AREA</FieldLabel>
                <Text className="text-neutral-800 text-sm font-medium mt-0.5">
                  {card.serviceArea || "Not provided"}
                </Text>
              </View>
              <View className="flex-1">
                <FieldLabel hint="(unverified)">LICENSE / REG. NO.</FieldLabel>
                <Text
                  className="text-neutral-800 text-sm mt-0.5"
                  style={mono}
                >
                  {card.licenseNumber || "—"}
                </Text>
              </View>
            </View>

            <View className="flex-row mt-4">
              <View className="flex-1 pr-3">
                <FieldLabel>KYC APPROVED</FieldLabel>
                <Text className="text-neutral-800 text-sm font-medium mt-0.5">
                  {card.kycApprovedLabel}
                </Text>
              </View>
              <View className="flex-1">
                <FieldLabel>STATUS</FieldLabel>
                <View className="flex-row items-center mt-1">
                  <View
                    className="w-2 h-2 rounded-full mr-1.5"
                    style={{ backgroundColor: accent }}
                  />
                  <Text
                    className="text-sm font-medium"
                    style={{ color: colors.neutral[800] }}
                  >
                    {card.statusLabel}
                  </Text>
                </View>
              </View>
            </View>

            <View className="h-px bg-neutral-200 my-5" />

            <View className="flex-row">
              <View className="w-[76px] h-[76px] rounded-lg border border-neutral-200 items-center justify-center mr-3">
                <QRCode
                  value={card.verificationUrl}
                  size={64}
                  color={colors.neutral[800]}
                  backgroundColor="#FFFFFF"
                />
              </View>
              <View className="flex-1">
                <Text className="text-neutral-800 text-sm font-semibold">
                  Scan for live verification
                </Text>
                <Text
                  className="text-xs mt-1 leading-4"
                  style={{ color: colors.neutral[500] }}
                >
                  Opens a secure HomeEase page confirming this worker&apos;s
                  current KYC status and active booking — this printed card alone
                  is not proof of standing.
                </Text>
              </View>
            </View>

            <Text
              className="mt-5 text-[10px] leading-4"
              style={{ color: colors.neutral[400], letterSpacing: 0.3 }}
            >
              HOMEEASE PLATFORM ID · NOT A GOVERNMENT ID · UNMARKED FIELDS ARE
              SELF-REPORTED
            </Text>
          </View>
        </View>

        {/* helper */}
        <View
          className="bg-card-light rounded-2xl p-4 mt-6"
          style={cardShadow}
        >
          <Text className="text-text-primary font-semibold mb-2">
            How to use it
          </Text>
          <Text className="text-text-secondary text-sm">
            Show this card to clients before starting work. Ask them to compare
            your photo and name against the worker shown on their booking screen,
            and to scan the code if they want to confirm your current standing.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
