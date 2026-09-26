import React, { useCallback } from "react";
import { View, Text, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { AppIcon as Ionicons } from "../../../components/icons/AppIcon";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import { colors } from "../../../constants";
import { useWorkerSetupStatus, SETUP_ITEM_ROUTES } from "../../../hooks/useWorkerSetupStatus";

/**
 * The worker's account-setup checklist. Clients can't find or book the
 * worker, and the worker can't accept requests, until every item is done.
 */
export default function WorkerSetupScreen() {
  const router = useRouter();
  const { status, refresh } = useWorkerSetupStatus();

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const doneCount = status?.items.filter((i) => i.done).length ?? 0;
  const total = status?.items.length ?? 0;

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Finish Your Setup" showBack />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {!status ? (
          <View className="items-center py-10">
            <ActivityIndicator size="small" />
          </View>
        ) : (
          <>
            <View
              className={`rounded-2xl p-4 mb-4 ${status.complete ? "bg-success/10" : "bg-warning/10"}`}
            >
              <Text className={`font-bold text-base ${status.complete ? "text-success" : "text-warning"}`}>
                {status.complete ? "You're all set" : `${doneCount} of ${total} done`}
              </Text>
              <Text className="text-text-secondary text-sm mt-1">
                {status.complete
                  ? "Clients can now find and book you, and you can accept requests."
                  : "Clients can't find or book you, and you can't accept requests, until every step below is done."}
              </Text>
            </View>

            {status.items.map((item) => {
              const route = SETUP_ITEM_ROUTES[item.key];
              return (
                <Pressable
                  key={item.key}
                  accessibilityRole="button"
                  accessibilityState={{ checked: item.done }}
                  onPress={() => router.push(route.path as any)}
                  className="bg-card rounded-2xl p-4 mb-3 flex-row items-center"
                >
                  <Ionicons
                    name={item.done ? "checkmark-circle" : "ellipse-outline"}
                    size={24}
                    color={item.done ? colors.success : colors.text.muted}
                  />
                  <View className="flex-1 ml-3">
                    <Text
                      className={`font-semibold text-sm ${item.done ? "text-text-muted" : "text-text-primary"}`}
                    >
                      {item.label}
                    </Text>
                    {!item.done && <Text className="text-text-muted text-xs mt-0.5">{route.hint}</Text>}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.text.muted} />
                </Pressable>
              );
            })}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
