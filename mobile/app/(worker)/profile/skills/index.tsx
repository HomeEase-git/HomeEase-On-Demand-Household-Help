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
import type { WorkerServiceType, TaskCatalogEntry } from "../../../../services/api";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

type CatalogField = {
  id: string;
  label: string;
  fieldType: string;
  usedForMatching?: boolean;
  options?: { id: string; label: string }[];
  // Jobs this question is limited to; empty = every job in the category.
  taskLinks?: { serviceTaskId: string }[];
};

type ScopeServiceType = WorkerServiceType & {
  scopeFields?: CatalogField[];
  tasks?: { id: string; name: string }[];
};

type CatalogTask = TaskCatalogEntry["tasks"][number]["task"];

// "for Aircon Cleaning, Freon Recharge" under a question limited to certain
// jobs, so two jobs' questions with the same text can be told apart.
function jobsCaption(field: CatalogField, category: ScopeServiceType): string | null {
  const names = (field.taskLinks ?? [])
    .map((l) => category.tasks?.find((t) => t.id === l.serviceTaskId)?.name)
    .filter(Boolean);
  return names.length ? `for ${names.join(", ")}` : null;
}

// The admin's price, read-only for the worker.
function priceLabel(task: CatalogTask): string {
  if (task.pricingModel === "CUSTOM_QUOTE" || task.price == null) return "Quoted on-site";
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
  const [scopeCatalog, setScopeCatalog] = useState<ScopeServiceType[]>([]);
  const [selectedOptionIds, setSelectedOptionIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  // Tasks with a save in flight — a second tap waits for the first to land.
  const inFlight = useRef<Set<string>>(new Set());

  // Only the first load shows a spinner; returning to the screen (e.g. from
  // the request form) refreshes quietly in place.
  const load = useCallback(async () => {
    try {
      const [taskCatalog, scopeTypes, capabilities] = await Promise.all([
        api.getMyTaskCatalog(),
        api.getServiceTypes(),
        api.getMyCapabilities(),
      ]);
      setCatalog(taskCatalog);
      setScopeCatalog(scopeTypes as ScopeServiceType[]);
      setSelectedOptionIds(new Set(capabilities));
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

  const verifiedCategoryIds = useMemo(() => new Set(registered.map((c) => c.serviceType.id)), [registered]);

  // Only the worker's own VERIFIED categories that actually have a field the
  // admin flagged "use to match workers" — most categories won't (e.g.
  // Cleaning), so this list is often empty, which is expected.
  const matchingCategories = useMemo(
    () =>
      scopeCatalog.filter(
        (c) => verifiedCategoryIds.has(c.id) && (c.scopeFields ?? []).some((f) => f.usedForMatching),
      ),
    [scopeCatalog, verifiedCategoryIds],
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

  const toggleOption = (optionId: string) => {
    setSelectedOptionIds((prev) => {
      const next = new Set(prev);
      if (next.has(optionId)) next.delete(optionId);
      else next.add(optionId);
      return next;
    });
  };

  const handleSaveCapabilities = async () => {
    setSaving(true);
    try {
      const updated = await api.replaceMyCapabilities(Array.from(selectedOptionIds));
      setSelectedOptionIds(new Set(updated));
      alertModal.success("Saved", "Clients asking for these specifically will now see you.");
    } catch (error) {
      console.error("Save capabilities error:", error);
      alertModal.error("Error", "Failed to save. Please try again.");
    } finally {
      setSaving(false);
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
          Tick the tasks you do. Prices are set by HomeEase and are the same for every pro.
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

        {!loading && matchingCategories.length > 0 && (
          <>
            <Text className="text-text-primary font-bold mb-1 mt-8">Your Specialization</Text>
            <Text className="text-text-muted text-sm mb-3">
              Check off exactly what you handle. Clients who ask for something specific only see pros
              who&apos;ve checked it.
            </Text>

            {matchingCategories.map((category) => (
              <View key={category.id} className="bg-card rounded-2xl p-4 mb-4">
                <Text className="text-text-primary font-bold text-sm mb-3">{category.name}</Text>
                {(category.scopeFields ?? [])
                  .filter((f) => f.usedForMatching)
                  .map((field) => (
                    <View key={field.id} className="mb-3 last:mb-0">
                      <Text className="text-text-secondary font-semibold text-xs mb-2">
                        {field.label}
                        {jobsCaption(field, category) && (
                          <Text className="text-text-muted font-normal"> · {jobsCaption(field, category)}</Text>
                        )}
                      </Text>
                      <View className="flex-row flex-wrap gap-2">
                        {(field.options ?? []).map((option) => {
                          const isSelected = selectedOptionIds.has(option.id);
                          return (
                            <Pressable
                              key={option.id}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: isSelected }}
                              onPress={() => toggleOption(option.id)}
                              className={`rounded-full px-4 py-2.5 border ${
                                isSelected ? "bg-accent border-accent" : "bg-white border-divider"
                              }`}
                            >
                              <Text
                                className={`font-medium text-sm ${isSelected ? "text-white" : "text-text-secondary"}`}
                              >
                                {option.label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  ))}
              </View>
            ))}

            <PrimaryButton
              label="Save Specialization"
              fullWidth
              onPress={handleSaveCapabilities}
              disabled={saving}
              loading={saving}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
