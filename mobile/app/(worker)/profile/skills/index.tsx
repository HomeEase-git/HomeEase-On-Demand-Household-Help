import React, { useEffect, useState } from "react";
import { View, Text, FlatList, Pressable, Modal, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import SkillCard from "../../../../components/cards/SkillCard";
import InputField from "../../../../components/ui/InputField";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import { colors } from "../../../../constants";
import { skillStorage } from "../../../../utils/storage";

type Skill = {
  id: string;
  name: string;
  category: string;
  rate: number;
};

export default function SkillsScreen() {
  const router = useRouter();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [skillName, setSkillName] = useState("");
  const [skillCategory, setSkillCategory] = useState("");
  const [skillRate, setSkillRate] = useState("");

  useEffect(() => {
    const loadSkills = async () => {
      const stored = await skillStorage.list();
      setSkills(stored);
    };

    loadSkills();
  }, []);

  const handleAddSkill = async () => {
    if (!skillName.trim() || !skillCategory.trim() || !skillRate.trim()) {
      Alert.alert("Error", "Please fill in all fields.");
      return;
    }
    const rate = parseFloat(skillRate);
    if (isNaN(rate) || rate <= 0) {
      Alert.alert("Error", "Please enter a valid rate.");
      return;
    }
    const newSkill = await skillStorage.create({
      name: skillName.trim(),
      category: skillCategory.trim(),
      rate,
    });
    if (newSkill) {
      setSkills((prev) => [...prev, newSkill]);
    }
    setSkillName("");
    setSkillCategory("");
    setSkillRate("");
    setShowModal(false);
  };

  const handleDeleteSkill = (id: string) => {
    Alert.alert("Delete Skill", "Are you sure you want to remove this skill?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const ok = await skillStorage.remove(id);
          if (ok) {
            setSkills((prev) => prev.filter((s) => s.id !== id));
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Skills & Services" showBack />
      <FlatList
        data={skills}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
        ListEmptyComponent={
          <View className="items-center py-16">
            <Ionicons
              name="construct-outline"
              size={48}
              color={colors.text.muted}
            />
            <Text className="text-text-secondary mt-3">
              No skills added yet
            </Text>
            <Text className="text-text-muted text-sm mt-1">
              Tap + to add your first skill
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <SkillCard
            skill={item}
            onEdit={() => Alert.alert("Edit", "Edit skill coming soon.")}
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
              />
              <OutlinedButton
                label="Cancel"
                onPress={() => setShowModal(false)}
              />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
