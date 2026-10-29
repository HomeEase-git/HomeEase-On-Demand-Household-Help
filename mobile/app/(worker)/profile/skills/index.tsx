import React, { useCallback, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import { colors } from "../../../../constants";
import * as api from "../../../../services/api";
import type { TaskCatalogEntry } from "../../../../services/api";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

type CatalogTask = TaskCatalogEntry["tasks"][number]["task"];

// The admin's price, read-only for the worker.
function priceLabel(task: CatalogTask): string {
  if (task.price == null) return "No price yet";
  const amount = `₱${task.price.toLocaleString("en-PH")}`;
  const perUnit = task.pricingModel === "PER_UNIT" || task.pricingModel === "TIERED";
  return perUnit && task.unitLabel ? `${amount} / ${task.unitLabel}` : amount;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

export default function SkillsScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();

  const [catalog, setCatalog] = useState<TaskCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  // Tasks with a save in flight — a second tap waits for the first to land.
  const inFlight = useRef<Set<string>>(new Set());

  // Only the first load shows a spinner; returning to the screen (e.g. from
  // the request form) refreshes quietly in place.
  const load = useCallback(async () => {
    try {
      setCatalog(await api.getMyTaskCatalog());
    } catch (error) {
      console.error("Load skills error:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const registered = useMemo(() => catalog.filter((c) => c.categoryStatus === "VERIFIED"), [catalog]);
  const requests = useMemo(
    () => catalog.filter((c) => c.categoryStatus === "PENDING_VERIFICATION" || c.categoryStatus === "REJECTED"),
    [catalog],
  );
  const canRequestMore = useMemo(
    () => catalog.some((c) => c.categoryStatus == null || c.categoryStatus === "REJECTED"),
    [catalog],
  );

  const setTaskSelected = (taskId: string, selected: boolean) => {
    setCatalog((prev) =>
      prev.map((cat) => ({
        ...cat,
        tasks: cat.tasks.map((t) =>
          t.task.id === taskId
            ? {
                ...t,
                mySelection: selected
                  ? { id: t.mySelection?.id ?? `local-${taskId}`, serviceTaskId: taskId, isActive: true }
                  : t.mySelection
                    ? { ...t.mySelection, isActive: false }
                    : null,
              }
            : t,
        ),
      })),
    );
  };

  // Updates the checkbox immediately and saves in the background; the page
  // never reloads. Rolls back (with a message) only if the save fails.
  const handleToggleTask = async (taskEntry: TaskCatalogEntry["tasks"][number]) => {
    const taskId = taskEntry.task.id;
    if (inFlight.current.has(taskId)) return;
    const wasSelected = !!taskEntry.mySelection?.isActive;

    inFlight.current.add(taskId);
    setTaskSelected(taskId, !wasSelected);
    try {
      if (wasSelected) await api.deselectTask(taskId);
      else await api.selectTask(taskId);
    } catch (error: any) {
      console.error("Toggle task error:", error);
      setTaskSelected(taskId, wasSelected);
      alertModal.error("Error", error?.message || "Couldn't save that change. Please try again.");
    } finally {
      inFlight.current.delete(taskId);
    }
  };

  const handleWithdraw = (category: TaskCatalogEntry) => {
    alertModal.confirm(
      "Withdraw request",
      `Withdraw your request to offer ${category.serviceType.name}? Your uploaded documents stay in My Documents.`,
      {
        confirmText: "Withdraw",
        destructive: true,
        onConfirm: async () => {
          setWithdrawingId(category.serviceType.id);
          try {
            await api.removeServiceType(category.serviceType.id);
            setCatalog((prev) =>
              prev.map((c) =>
                c.serviceType.id === category.serviceType.id
                  ? { ...c, categoryStatus: null, rejectionReason: null, requestedAt: null }
                  : c,
              ),
            );
          } catch (error) {
            console.error("Withdraw request error:", error);
            alertModal.error("Error", "Failed to withdraw the request. Please try again.");
          } finally {
            setWithdrawingId(null);
          }
        },
      },
    );
  };

  const openRequestForm = (serviceTypeId?: string) =>
    router.push({ pathname: "/(worker)/profile/skills/request" as any, params: serviceTypeId ? { serviceTypeId } : {} });

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Skills & Services" showBack />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        <Text className="text-text-primary font-bold mb-1">Services You Offer</Text>
        <Text className="text-text-muted text-sm mb-4">
          Tick the tasks you do. Prices are set by HomeEase and are the same for every worker.
        </Text>

        {loading && (
          <View className="items-center py-10">
            <ActivityIndicator size="small" />
          </View>
        )}

        {!loading && registered.length === 0 && (
          <View className="bg-card rounded-2xl p-4 mb-3">
            <Text className="text-text-secondary text-sm">
              You aren&apos;t registered for any service yet. Request one below to start getting bookings.
            </Text>
          </View>
        )}

        {!loading &&
          registered.map((category) => (
            <View key={category.serviceType.id} className="bg-card rounded-2xl p-4 mb-3">
              <Text className="text-text-primary font-bold text-sm mb-2">{category.serviceType.name}</Text>
              {category.tasks.length === 0 ? (
                <Text className="text-text-muted text-sm">No tasks listed for this service yet.</Text>
              ) : (
                category.tasks.map((t) => {
                  const isSelected = !!t.mySelection?.isActive;
                  return (
                    <Pressable
                      key={t.task.id}
                      onPress={() => handleToggleTask(t)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: isSelected }}
                      accessibilityLabel={`${t.task.name}, ${priceLabel(t.task)}`}
                      className="flex-row items-center py-2"
                    >
                      <Ionicons
                        name={isSelected ? "checkbox" : "square-outline"}
                        size={20}
                        color={isSelected ? colors.accent.DEFAULT : colors.text.muted}
                      />
                      <Text
                        className={`ml-2.5 text-sm flex-1 ${
                          isSelected ? "text-text-primary font-medium" : "text-text-secondary"
                        }`}
                      >
                        {t.task.name}
                      </Text>
                      <Text className="text-text-muted text-xs ml-2">{priceLabel(t.task)}</Text>
                    </Pressable>
                  );
                })
              )}
            </View>
          ))}

        {!loading && requests.length > 0 && (
          <>
            <Text className="text-text-primary font-bold mb-1 mt-4">Your Requests</Text>
            <Text className="text-text-muted text-sm mb-3">
              You can pick tasks in a service once an admin approves your documents.
            </Text>
            {requests.map((category) => {
              const pending = category.categoryStatus === "PENDING_VERIFICATION";
              return (
                <View key={category.serviceType.id} className="bg-card rounded-2xl p-4 mb-3">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-text-primary font-bold text-sm flex-1 mr-2">
                      {category.serviceType.name}
                    </Text>
                    <View className={`${pending ? "bg-warning/10" : "bg-error/10"} rounded-full px-2.5 py-1`}>
                      <Text className={`${pending ? "text-warning" : "text-error"} text-xs font-semibold`}>
                        {pending ? "Pending Admin Review" : "Declined"}
                      </Text>
                    </View>
                  </View>
                  {pending && !!category.requestedAt && (
                    <Text className="text-text-muted text-xs mt-1">Requested {formatDate(category.requestedAt)}</Text>
                  )}
                  {!pending && !!category.rejectionReason && (
                    <Text className="text-text-secondary text-xs mt-2">{category.rejectionReason}</Text>
                  )}
                  <View className="flex-row mt-3">
                    {pending ? (
                      <OutlinedButton
                        label="Withdraw Request"
                        disabled={withdrawingId === category.serviceType.id}
                        onPress={() => handleWithdraw(category)}
                      />
                    ) : (
                      <OutlinedButton label="Request Again" onPress={() => openRequestForm(category.serviceType.id)} />
                    )}
                  </View>
                </View>
              );
            })}
          </>
        )}

        {!loading && canRequestMore && (
          <View className="mt-2">
            <PrimaryButton label="Request a New Service" fullWidth onPress={() => openRequestForm()} />
            <Text className="text-text-muted text-xs mt-2 text-center">
              Upload certifications or documents that prove your skills. An admin reviews them first.
            </Text>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}
