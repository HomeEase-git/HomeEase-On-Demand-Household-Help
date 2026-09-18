import React, { useCallback, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, Modal, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import InputField from "../../../../components/ui/InputField";
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
};

type ScopeServiceType = WorkerServiceType & { scopeFields?: CatalogField[] };

type PriceableTask = TaskCatalogEntry["tasks"][number] & { serviceTypeName: string };

// Matches backend taskPriceService.MAX_TIER_ROWS — keeps the "Add step"
// button from producing a table the server would just reject.
const MAX_TIER_ROWS = 5;

type TierRowInput = { upToQty: string; price: string };

export default function SkillsScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();

  const [catalog, setCatalog] = useState<TaskCatalogEntry[]>([]);
  const [scopeCatalog, setScopeCatalog] = useState<ScopeServiceType[]>([]);
  const [selectedOptionIds, setSelectedOptionIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  const [priceModalEntry, setPriceModalEntry] = useState<PriceableTask | null>(null);
  const [priceInput, setPriceInput] = useState("");
  const [tierRows, setTierRows] = useState<TierRowInput[]>([]);
  const [savingPrice, setSavingPrice] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
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

  // Refreshes on every return to this screen — including coming back from
  // the certification-upload flow after submitting a new category for
  // review, so the "Pending Admin Review" badge shows up immediately.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const verifiedCategoryIds = useMemo(
    () => new Set(catalog.filter((c) => c.categoryStatus === "VERIFIED").map((c) => c.serviceType.id)),
    [catalog],
  );

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

  // Every selected, non-quote task under a VERIFIED category — the only
  // ones that can actually be priced/booked right now.
  const priceableTasks = useMemo<PriceableTask[]>(() => {
    const list: PriceableTask[] = [];
    for (const cat of catalog) {
      if (cat.categoryStatus !== "VERIFIED") continue;
      for (const t of cat.tasks) {
        if (!t.mySelection?.isActive) continue;
        if (t.task.pricingModel === "CUSTOM_QUOTE") continue;
        list.push({ ...t, serviceTypeName: cat.serviceType.name });
      }
    }
    return list;
  }, [catalog]);

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

  const handleToggleTask = async (category: TaskCatalogEntry, taskEntry: TaskCatalogEntry["tasks"][number]) => {
    const taskId = taskEntry.task.id;
    const isSelected = !!taskEntry.mySelection?.isActive;

    if (isSelected) {
      setBusyTaskId(taskId);
      try {
        await api.deselectTask(taskId);
        await load();
      } catch (error) {
        console.error("Deselect task error:", error);
        alertModal.error("Error", "Failed to update. Please try again.");
      } finally {
        setBusyTaskId(null);
      }
      return;
    }

    // A brand-new (or previously declined) category always needs a
    // supporting document UNLESS this would be the worker's very first
    // category ever — matches the backend's runCategoryGate exactly (see
    // workerController.ts): the first category is only gated when the
    // admin flagged it requiresCertification, and that case still requires
    // an already-APPROVED certification (uploading one here wouldn't help —
    // it would only create a PENDING one), so it's left to fail with the
    // backend's own explanatory message rather than routed anywhere.
    const isNewConnection = category.categoryStatus == null || category.categoryStatus === "REJECTED";
    const hasAnyOtherCategory = catalog.some(
      (c) => c.categoryStatus === "VERIFIED" || c.categoryStatus === "PENDING_VERIFICATION",
    );

    if (isNewConnection && hasAnyOtherCategory) {
      router.push({
        pathname: "/(worker)/profile/certifications/upload",
        params: { serviceTypeId: category.serviceType.id, taskId, purpose: "category-gate" },
      });
      return;
    }

    setBusyTaskId(taskId);
    try {
      await api.selectTask(taskId);
      await load();
    } catch (error: any) {
      console.error("Select task error:", error);
      alertModal.error("Error", error?.message || "Failed to select this task. Please try again.");
    } finally {
      setBusyTaskId(null);
    }
  };

  const openPriceModal = (entry: PriceableTask) => {
    setPriceModalEntry(entry);
    if (entry.task.pricingModel === "TIERED") {
      const rows = entry.myTiers.length
        ? entry.myTiers.map((t) => ({ upToQty: t.upToQty != null ? String(t.upToQty) : "", price: String(t.price) }))
        : [{ upToQty: "", price: "" }];
      setTierRows(rows);
      setPriceInput("");
      return;
    }
    const current = entry.task.pricingModel === "PER_UNIT" ? entry.myPrice?.unitPrice : entry.myPrice?.price;
    setPriceInput(current != null ? String(current) : "");
  };

  const closePriceModal = () => {
    setPriceModalEntry(null);
    setPriceInput("");
    setTierRows([]);
  };

  const addTierRow = () => {
    setTierRows((prev) => (prev.length >= MAX_TIER_ROWS ? prev : [...prev, { upToQty: "", price: "" }]));
  };

  const removeTierRow = (index: number) => {
    setTierRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const updateTierRow = (index: number, field: keyof TierRowInput, value: string) => {
    setTierRows((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  // Client-side mirror of the backend's taskPriceService.validateTierRows —
  // catches obvious mistakes before a round trip, but the server always
  // re-validates (never trusts this).
  const validateTierRows = (task: PriceableTask["task"]): string | null => {
    if (tierRows.length === 0) return "At least one price step is required.";
    const parsed = tierRows.map((r) => ({ upToQty: r.upToQty.trim() === "" ? null : Number(r.upToQty), price: Number(r.price) }));
    for (let i = 0; i < parsed.length; i++) {
      const row = parsed[i];
      if (Number.isNaN(row.price)) return "Every step needs a valid price.";
      if (task.minPrice != null && task.maxPrice != null && (row.price < task.minPrice || row.price > task.maxPrice)) {
        return `Every step's price must be between ₱${task.minPrice} and ₱${task.maxPrice}.`;
      }
      if (row.upToQty == null) {
        if (i !== parsed.length - 1) return "Only the last step may be left blank (open-ended).";
        continue;
      }
      if (Number.isNaN(row.upToQty) || row.upToQty <= 0) return "Every step's quantity limit must be a positive number.";
      if (i > 0) {
        const prev = parsed[i - 1].upToQty;
        if (prev == null || row.upToQty <= prev) return "Quantity limits must strictly increase from one step to the next.";
      }
    }
    return null;
  };

  const handleSavePrice = async () => {
    if (!priceModalEntry) return;
    const { task } = priceModalEntry;

    if (task.pricingModel === "TIERED") {
      const validationError = validateTierRows(task);
      if (validationError) {
        alertModal.error("Error", validationError);
        return;
      }
      setSavingPrice(true);
      try {
        const tiers = tierRows.map((r) => ({
          upToQty: r.upToQty.trim() === "" ? null : Number(r.upToQty),
          price: Number(r.price),
        }));
        await api.setMyTaskPrice(task.id, { tiers });
        closePriceModal();
        await load();
      } catch (error) {
        console.error("Set task price error:", error);
        alertModal.error("Error", "Failed to save prices. Please try again.");
      } finally {
        setSavingPrice(false);
      }
      return;
    }

    const value = parseFloat(priceInput);

    if (Number.isNaN(value)) {
      alertModal.error("Error", "Please enter a valid amount.");
      return;
    }
    if (task.minPrice != null && task.maxPrice != null && (value < task.minPrice || value > task.maxPrice)) {
      alertModal.error("Error", `Must be between ₱${task.minPrice} and ₱${task.maxPrice}.`);
      return;
    }

    setSavingPrice(true);
    try {
      const data = task.pricingModel === "PER_UNIT" ? { unitPrice: value } : { price: value };
      await api.setMyTaskPrice(task.id, data);
      closePriceModal();
      await load();
    } catch (error) {
      console.error("Set task price error:", error);
      alertModal.error("Error", "Failed to save price. Please try again.");
    } finally {
      setSavingPrice(false);
    }
  };

  const categoryBadge = (status: TaskCatalogEntry["categoryStatus"]) => {
    if (status === "PENDING_VERIFICATION") {
      return (
        <View className="bg-warning/10 rounded-full px-2.5 py-1">
          <Text className="text-warning text-xs font-semibold">Pending Admin Review</Text>
        </View>
      );
    }
    if (status === "REJECTED") {
      return (
        <View className="bg-error/10 rounded-full px-2.5 py-1">
          <Text className="text-error text-xs font-semibold">Declined</Text>
        </View>
      );
    }
    return null;
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Skills & Services" showBack />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
        <Text className="text-text-primary font-bold mb-1">Services You Offer</Text>
        <Text className="text-text-muted text-sm mb-4">
          Check off every task you actually perform, from the list your admin has set up. A brand-new
          category beyond your first needs one supporting document for an admin to review before it goes
          live — you&apos;ll see it here as &quot;Pending Admin Review&quot; until then.
        </Text>

        {loading && (
          <View className="items-center py-10">
            <ActivityIndicator size="small" />
          </View>
        )}

        {!loading && catalog.length === 0 && (
          <View className="bg-card rounded-2xl p-4">
            <Text className="text-text-secondary text-sm">No services have been set up yet.</Text>
          </View>
        )}

        {!loading &&
          catalog.map((category) => {
            const badge = categoryBadge(category.categoryStatus);
            const isDim = category.categoryStatus === "PENDING_VERIFICATION" || category.categoryStatus === "REJECTED";
            return (
              <View key={category.serviceType.id} className="bg-card rounded-2xl p-4 mb-3">
                <View className="flex-row items-center justify-between mb-3">
                  <Text className={`font-bold text-sm ${isDim ? "text-text-muted" : "text-text-primary"}`}>
                    {category.serviceType.name}
                  </Text>
                  {badge}
                </View>
                {category.tasks.length === 0 ? (
                  <Text className="text-text-muted text-sm">No tasks listed for this category yet.</Text>
                ) : (
                  category.tasks.map((t) => {
                    const isSelected = !!t.mySelection?.isActive;
                    const isBusy = busyTaskId === t.task.id;
                    return (
                      <Pressable
                        key={t.task.id}
                        disabled={isBusy}
                        onPress={() => handleToggleTask(category, t)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: isSelected }}
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
                        {isBusy && <ActivityIndicator size="small" />}
                      </Pressable>
                    );
                  })
                )}
              </View>
            );
          })}

        <Text className="text-text-primary font-bold mb-1 mt-6">Your Specialization</Text>
        <Text className="text-text-muted text-sm mb-3">
          For categories where it matters, check off exactly what you handle — clients asking for
          something specific will only be shown pros who&apos;ve checked it.
        </Text>

        {!loading && matchingCategories.length === 0 && (
          <View className="bg-card rounded-2xl p-4">
            <Text className="text-text-secondary text-sm">
              None of your current categories have a specialization question. This section fills in
              automatically if you add one that does (e.g. Home Appliance &amp; Aircon Repair).
            </Text>
          </View>
        )}

        {!loading &&
          matchingCategories.map((category) => (
            <View key={category.id} className="bg-card rounded-2xl p-4 mb-4">
              <Text className="text-text-primary font-bold text-sm mb-3">{category.name}</Text>
              {(category.scopeFields ?? [])
                .filter((f) => f.usedForMatching)
                .map((field) => (
                  <View key={field.id} className="mb-3 last:mb-0">
                    <Text className="text-text-secondary font-semibold text-xs mb-2">{field.label}</Text>
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

        {!loading && matchingCategories.length > 0 && (
          <PrimaryButton
            label="Save Specialization"
            fullWidth
            onPress={handleSaveCapabilities}
            disabled={saving}
            loading={saving}
          />
        )}

        <Text className="text-text-primary font-bold mb-1 mt-6">Your Prices</Text>
        <Text className="text-text-muted text-sm mb-3">
          Set your own price for each task you&apos;ve selected, within the range the admin allows.
        </Text>

        {!loading && priceableTasks.length === 0 && (
          <View className="bg-card rounded-2xl p-4">
            <Text className="text-text-secondary text-sm">
              Check off a task above to price it here.
            </Text>
          </View>
        )}

        {!loading &&
          priceableTasks.map((entry) => {
            const { task, myPrice, myTiers } = entry;
            const isPerUnit = task.pricingModel === "PER_UNIT";
            const isTiered = task.pricingModel === "TIERED";
            const currentValue = isPerUnit ? myPrice?.unitPrice : myPrice?.price;
            const activeTierCount = myTiers.filter((t) => t.isActive).length;
            const isPriced = isTiered ? activeTierCount > 0 : myPrice?.isActive && currentValue != null;

            return (
              <Pressable
                key={task.id}
                onPress={() => openPriceModal(entry)}
                className="bg-card rounded-2xl p-4 mb-3 flex-row items-center justify-between"
              >
                <View className="flex-1 pr-3">
                  <Text className="text-text-primary font-semibold text-sm">{task.name}</Text>
                  <Text className="text-text-muted text-xs mt-1">
                    Admin allows ₱{task.minPrice}–₱{task.maxPrice}
                    {isPerUnit || isTiered ? `/${task.unitLabel}` : ""}
                  </Text>
                </View>
                <View className="flex-row items-center">
                  {!isPriced && <View className="w-2 h-2 rounded-full bg-warning mr-2" />}
                  <Text className={`text-sm font-bold ${isPriced ? "text-accent" : "text-warning"}`}>
                    {isTiered
                      ? isPriced
                        ? `${activeTierCount} price step${activeTierCount === 1 ? "" : "s"} set`
                        : "Set your prices"
                      : isPriced
                        ? `₱${currentValue}${isPerUnit ? `/${task.unitLabel}` : ""}`
                        : "Set your price"}
                  </Text>
                </View>
              </Pressable>
            );
          })}
      </ScrollView>

      <Modal visible={!!priceModalEntry} transparent animationType="slide">
        <View className="flex-1 bg-black/40 justify-end">
          <View className="bg-white rounded-t-3xl p-6 pb-8">
            <View className="flex-row justify-between items-center mb-6">
              <Text className="text-text-primary text-xl font-bold">{priceModalEntry?.task.name}</Text>
              <Pressable onPress={closePriceModal}>
                <Ionicons name="close" size={24} color={colors.text.primary} />
              </Pressable>
            </View>

            {priceModalEntry && priceModalEntry.task.pricingModel === "TIERED" && (
              <>
                <Text className="text-text-muted text-sm mb-1">
                  Admin allows ₱{priceModalEntry.task.minPrice}–₱{priceModalEntry.task.maxPrice}/
                  {priceModalEntry.task.unitLabel} per step.
                </Text>
                {!!priceModalEntry.task.description && (
                  <Text className="text-text-muted text-xs mb-4">{priceModalEntry.task.description}</Text>
                )}
                <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ paddingBottom: 4 }}>
                  {tierRows.map((row, index) => {
                    const isLast = index === tierRows.length - 1;
                    return (
                      <View key={index} className="flex-row items-end gap-2 mb-3">
                        <View className="flex-1">
                          <InputField
                            label={isLast ? `Up to (${priceModalEntry.task.unitLabel}, blank = no limit)` : `Up to (${priceModalEntry.task.unitLabel})`}
                            value={row.upToQty}
                            onChangeText={(v) => updateTierRow(index, "upToQty", v)}
                            placeholder={isLast ? "e.g. 20 or blank" : "e.g. 20"}
                            keyboardType="number-pad"
                          />
                        </View>
                        <View className="flex-1">
                          <InputField
                            label="Price (₱)"
                            value={row.price}
                            onChangeText={(v) => updateTierRow(index, "price", v)}
                            placeholder="e.g. 1000"
                            keyboardType="number-pad"
                          />
                        </View>
                        {tierRows.length > 1 && (
                          <Pressable onPress={() => removeTierRow(index)} className="mb-3 p-2">
                            <Ionicons name="trash-outline" size={18} color={colors.error} />
                          </Pressable>
                        )}
                      </View>
                    );
                  })}
                </ScrollView>
                {tierRows.length < MAX_TIER_ROWS && (
                  <Pressable onPress={addTierRow} className="flex-row items-center mb-2">
                    <Ionicons name="add-circle-outline" size={18} color={colors.accent.DEFAULT} />
                    <Text className="text-accent text-sm font-semibold ml-1.5">Add a price step</Text>
                  </Pressable>
                )}
              </>
            )}

            {priceModalEntry && priceModalEntry.task.pricingModel !== "TIERED" && (
              <>
                <Text className="text-text-muted text-sm mb-4">
                  Admin allows ₱{priceModalEntry.task.minPrice}–₱{priceModalEntry.task.maxPrice}
                  {priceModalEntry.task.pricingModel === "PER_UNIT" ? `/${priceModalEntry.task.unitLabel}` : ""}
                </Text>
                <InputField
                  label={
                    priceModalEntry.task.pricingModel === "PER_UNIT"
                      ? `Your rate (₱/${priceModalEntry.task.unitLabel})`
                      : "Your price (₱)"
                  }
                  value={priceInput}
                  onChangeText={setPriceInput}
                  placeholder="e.g. 800"
                  keyboardType="number-pad"
                />
              </>
            )}

            <View className="gap-3 mt-2">
              <PrimaryButton
                label="Save Price"
                fullWidth
                onPress={handleSavePrice}
                disabled={savingPrice}
                loading={savingPrice}
              />
              <OutlinedButton label="Cancel" onPress={closePriceModal} />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
