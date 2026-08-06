import React, { useEffect, useState } from "react";
import { View, Text, FlatList, Pressable, Modal, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import SkillCard from "../../../../components/cards/SkillCard";
import InputField from "../../../../components/ui/InputField";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import { colors } from "../../../../constants";
import * as api from "../../../../services/api";
import type { Skill, WorkerServiceType } from "../../../../services/api";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

export default function SkillsScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [skillName, setSkillName] = useState("");
  const [skillCategory, setSkillCategory] = useState("");
  const [skillRate, setSkillRate] = useState("");

  const [myServiceTypes, setMyServiceTypes] = useState<WorkerServiceType[]>([]);
  const [catalogServiceTypes, setCatalogServiceTypes] = useState<WorkerServiceType[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [pendingCategoryIds, setPendingCategoryIds] = useState<string[]>([]);
  const [savingCategories, setSavingCategories] = useState(false);

  useEffect(() => {
    const loadSkills = async () => {
      setLoading(true);
      try {
        const stored = await api.getMySkills();
        setSkills(stored);
      } catch (error) {
        console.error("Load skills error:", error);
      } finally {
        setLoading(false);
      }
    };

    const loadServiceTypes = async () => {
      setCategoriesLoading(true);
      try {
        const [mine, catalog] = await Promise.all([
          api.getMyServiceTypes(),
          api.getServiceTypes(),
        ]);
        setMyServiceTypes(mine);
        setCatalogServiceTypes(catalog);
      } catch (error) {
        console.error("Load service types error:", error);
      } finally {
        setCategoriesLoading(false);
      }
    };

    loadSkills();
    loadServiceTypes();
  }, []);

  const handleAddSkill = async () => {
    if (!skillName.trim() || !skillCategory.trim() || !skillRate.trim()) {
      alertModal.error("Error", "Please fill in all fields.");
      return;
    }
    const rate = parseFloat(skillRate);
    if (isNaN(rate) || rate <= 0) {
      alertModal.error("Error", "Please enter a valid rate.");
      return;
    }
    setSaving(true);
    try {
      const newSkill = await api.addSkill({
        name: skillName.trim(),
        category: skillCategory.trim(),
        rate,
      });
      setSkills((prev) => [...prev, newSkill]);
      setSkillName("");
      setSkillCategory("");
      setSkillRate("");
      setShowModal(false);
    } catch (error) {
      console.error("Add skill error:", error);
      alertModal.error("Error", "Failed to add skill. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSkill = (id: string) => {
    alertModal.confirm(
      "Delete Skill",
      "Are you sure you want to remove this skill?",
      {
        confirmText: "Delete",
        destructive: true,
        onConfirm: async () => {
          try {
            await api.deleteSkill(id);
            setSkills((prev) => prev.filter((s) => s.id !== id));
          } catch (error) {
            console.error("Delete skill error:", error);
            alertModal.error("Error", "Failed to remove skill. Please try again.");
          }
        },
      },
    );
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
      <FlatList
        data={skills}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
        ListHeaderComponent={
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
              {!categoriesLoading && myServiceTypes.length === 0 && (
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
        }
        ListEmptyComponent={
          <View className="items-center py-16">
            <Ionicons
              name="construct-outline"
              size={48}
              color={colors.text.muted}
            />
            <Text className="text-text-secondary mt-3">
              {loading ? "Loading skills..." : "No skills added yet"}
            </Text>
            {!loading && (
              <Text className="text-text-muted text-sm mt-1">
                Tap + to add your first skill
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <SkillCard
            skill={item}
            onEdit={() => alertModal.info("Edit", "Edit skill coming soon.")}
            onDelete={() => handleDeleteSkill(item.id)}
          />
        )}
      />
      <Pressable
        className="absolute bottom-6 right-6 w-14 h-14 bg-accent rounded-full items-center justify-center"
        onPress={() => setShowModal(true)}
      >
        <Ionicons name="add" size={28} color={colors.white} />
      </Pressable>

      <Modal visible={showModal} transparent animationType="slide">
        <View className="flex-1 bg-black/40 justify-end">
          <View className="bg-white rounded-t-3xl p-6 pb-8">
            <View className="flex-row justify-between items-center mb-6">
              <Text className="text-text-primary text-xl font-bold">Add Skill</Text>
              <Pressable onPress={() => setShowModal(false)}>
                <Ionicons name="close" size={24} color={colors.text.primary} />
              </Pressable>
            </View>
            <InputField
              label="Skill Name"
              value={skillName}
              onChangeText={setSkillName}
              placeholder="e.g. Pipe Repair"
            />
            <InputField
              label="Category"
              value={skillCategory}
              onChangeText={setSkillCategory}
              placeholder="e.g. Plumbing"
            />
            <InputField
              label="Rate per hour (₱)"
              value={skillRate}
              onChangeText={setSkillRate}
              placeholder="e.g. 250"
              keyboardType="number-pad"
            />
            <View className="gap-3 mt-2">
              <PrimaryButton
                label="Add Skill"
                fullWidth
                onPress={handleAddSkill}
                disabled={saving}
                loading={saving}
              />
              <OutlinedButton
                label="Cancel"
                onPress={() => setShowModal(false)}
              />
            </View>
          </View>
        </View>
      </Modal>

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
                    You've already added every available category.
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
