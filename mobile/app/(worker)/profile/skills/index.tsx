import React, { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, Modal, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import { colors } from "../../../../constants";
import * as api from "../../../../services/api";
import type { WorkerServiceType } from "../../../../services/api";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

type CatalogField = {
  id: string;
  label: string;
  fieldType: string;
  usedForMatching?: boolean;
  options?: { id: string; label: string }[];
};

type CatalogServiceType = WorkerServiceType & { scopeFields?: CatalogField[] };

export default function SkillsScreen() {
  const alertModal = useAlertModal();

  const [myServiceTypes, setMyServiceTypes] = useState<WorkerServiceType[]>([]);
  const [catalogServiceTypes, setCatalogServiceTypes] = useState<CatalogServiceType[]>([]);
  const [selectedOptionIds, setSelectedOptionIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [pendingCategoryIds, setPendingCategoryIds] = useState<string[]>([]);
  const [savingCategories, setSavingCategories] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [mine, catalog, capabilities] = await Promise.all([
        api.getMyServiceTypes(),
        api.getServiceTypes(),
        api.getMyCapabilities(),
      ]);
      setMyServiceTypes(mine);
      setCatalogServiceTypes(catalog as CatalogServiceType[]);
      setSelectedOptionIds(new Set(capabilities));
    } catch (error) {
      console.error("Load skills error:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const myServiceTypeIds = useMemo(() => new Set(myServiceTypes.map((s) => s.id)), [myServiceTypes]);

  // Only the worker's own categories that actually have a field the admin
  // flagged "use to match workers" — most categories won't (e.g. Cleaning),
  // so this list is often empty, which is expected.
  const matchingCategories = useMemo(
    () =>
      catalogServiceTypes.filter(
        (c) => myServiceTypeIds.has(c.id) && (c.scopeFields ?? []).some((f) => f.usedForMatching)
      ),
    [catalogServiceTypes, myServiceTypeIds]
  );

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

  const handleRemoveCategory = (serviceTypeId: string) => {
    alertModal.confirm(
      "Remove Category",
      "Clients browsing this category won't see you anymore. Continue?",
      {
        confirmText: "Remove",
        destructive: true,
        onConfirm: async () => {
          try {
            await api.removeServiceType(serviceTypeId);
            setMyServiceTypes((prev) => prev.filter((s) => s.id !== serviceTypeId));
          } catch (error) {
            console.error("Remove service type error:", error);
            alertModal.error("Error", "Failed to remove category. Please try again.");
          }
        },
      },
    );
  };

  const openCategoryModal = () => {
    setPendingCategoryIds([]);
    setShowCategoryModal(true);
  };

  const toggleCatalogSelection = (id: string) => {
    setPendingCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id],
    );
  };

  const handleSaveCategories = async () => {
    if (pendingCategoryIds.length === 0) {
      setShowCategoryModal(false);
      return;
    }
    setSavingCategories(true);
    try {
      const updated = await api.addServiceTypes(pendingCategoryIds);
      setMyServiceTypes(updated);
      setShowCategoryModal(false);
    } catch (error) {
      console.error("Add service types error:", error);
      alertModal.error("Error", "Failed to save categories. Please try again.");
    } finally {
      setSavingCategories(false);
    }
  };

  const connectedIds = new Set(myServiceTypes.map((s) => s.id));
  const availableToAdd = catalogServiceTypes.filter((s) => !connectedIds.has(s.id));

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Skills & Services" showBack />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
        <View className="mb-6">
          <Text className="text-text-primary font-bold mb-1">Service Categories</Text>
          <Text className="text-text-muted text-sm mb-3">
            Categories you offer — clients browse and book by category.
          </Text>
          <View className="flex-row flex-wrap gap-2 mb-3">
            {myServiceTypes.map((service) => (
              <View
                key={service.id}
                className="flex-row items-center bg-accent/10 border-2 border-accent rounded-xl px-3.5 py-2.5"
              >
                <Text className="text-accent text-sm font-medium mr-2">{service.name}</Text>
                <Pressable onPress={() => handleRemoveCategory(service.id)} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={colors.accent.DEFAULT} />
                </Pressable>
              </View>
            ))}
            {!loading && myServiceTypes.length === 0 && (
              <Text className="text-text-muted text-sm">No categories added yet.</Text>
            )}
          </View>
          <Pressable
            className="flex-row items-center self-start bg-card rounded-xl px-3.5 py-2.5"
            onPress={openCategoryModal}
          >
            <Ionicons name="add" size={16} color={colors.text.secondary} />
            <Text className="text-text-secondary text-sm font-medium ml-1">Add Category</Text>
          </Pressable>
        </View>

        <Text className="text-text-primary font-bold mb-1">Your Specialization</Text>
        <Text className="text-text-muted text-sm mb-3">
          For categories where it matters, check off exactly what you handle — clients asking for
          something specific will only be shown pros who've checked it.
        </Text>

        {loading && (
          <View className="items-center py-10">
            <ActivityIndicator size="small" />
          </View>
        )}

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
      </ScrollView>

      <Modal visible={showCategoryModal} transparent animationType="slide">
        <View className="flex-1 bg-black/40 justify-end">
          <View className="bg-white rounded-t-3xl p-6 pb-8">
            <View className="flex-row justify-between items-center mb-6">
              <Text className="text-text-primary text-xl font-bold">Add Category</Text>
              <Pressable onPress={() => setShowCategoryModal(false)}>
                <Ionicons name="close" size={24} color={colors.text.primary} />
              </Pressable>
            </View>
            <ScrollView className="max-h-80">
              <View className="flex-row flex-wrap gap-2">
                {availableToAdd.map((service) => {
                  const isSelected = pendingCategoryIds.includes(service.id);
                  return (
                    <Pressable
                      key={service.id}
                      onPress={() => toggleCatalogSelection(service.id)}
                      className={`rounded-xl px-3.5 py-2.5 border-2 ${
                        isSelected ? "bg-accent/10 border-accent" : "bg-card border-transparent"
                      }`}
                    >
                      <Text
                        className={`text-sm font-medium ${
                          isSelected ? "text-accent" : "text-text-secondary"
                        }`}
                      >
                        {service.name}
                      </Text>
                    </Pressable>
                  );
                })}
                {availableToAdd.length === 0 && (
                  <Text className="text-text-muted text-sm">
                    You&apos;ve already added every available category.
                  </Text>
                )}
              </View>
            </ScrollView>
            <View className="gap-3 mt-4">
              <PrimaryButton
                label="Save"
                fullWidth
                onPress={handleSaveCategories}
                disabled={savingCategories || pendingCategoryIds.length === 0}
                loading={savingCategories}
              />
              <OutlinedButton
                label="Cancel"
                onPress={() => setShowCategoryModal(false)}
              />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
