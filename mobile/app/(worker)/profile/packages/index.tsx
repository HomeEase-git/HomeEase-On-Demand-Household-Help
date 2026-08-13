import React, { useEffect, useState } from "react";
import { View, Text, FlatList, Pressable, Modal, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import PackageCard from "../../../../components/cards/PackageCard";
import InputField from "../../../../components/ui/InputField";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import { colors } from "../../../../constants";
import * as api from "../../../../services/api";
import type { WorkerPackage, WorkerServiceType } from "../../../../services/api";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

export default function PackagesScreen() {
  const alertModal = useAlertModal();
  const [packages, setPackages] = useState<WorkerPackage[]>([]);
  const [myServiceTypes, setMyServiceTypes] = useState<WorkerServiceType[]>([]);
  const [loading, setLoading] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedServiceTypeId, setSelectedServiceTypeId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [pkgs, types] = await Promise.all([
          api.getMyPackages(),
          api.getMyServiceTypes(),
        ]);
        setPackages(pkgs);
        setMyServiceTypes(types);
      } catch (error) {
        console.error("Load packages error:", error);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setSelectedServiceTypeId(myServiceTypes[0]?.id ?? null);
    setName("");
    setDescription("");
    setPrice("");
  };

  const openCreateModal = () => {
    resetForm();
    setShowModal(true);
  };

  const openEditModal = (pkg: WorkerPackage) => {
    setEditingId(pkg.id);
    setSelectedServiceTypeId(pkg.serviceTypeId);
    setName(pkg.name);
    setDescription(pkg.description ?? "");
    setPrice(String(pkg.price));
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!selectedServiceTypeId) {
      alertModal.error("Error", "Add a service category before creating a package.");
      return;
    }
    if (!name.trim()) {
      alertModal.error("Error", "Please enter a package name.");
      return;
    }
    const parsedPrice = parseFloat(price);
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      alertModal.error("Error", "Please enter a valid price.");
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        const updated = await api.updatePackage(editingId, {
          serviceTypeId: selectedServiceTypeId,
          name: name.trim(),
          description: description.trim(),
          price: parsedPrice,
        });
        setPackages((prev) => prev.map((p) => (p.id === editingId ? updated : p)));
      } else {
        const created = await api.createPackage({
          serviceTypeId: selectedServiceTypeId,
          name: name.trim(),
          description: description.trim(),
          price: parsedPrice,
        });
        setPackages((prev) => [...prev, created]);
      }
      setShowModal(false);
    } catch (error) {
      console.error("Save package error:", error);
      alertModal.error("Error", "Failed to save package. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id: string) => {
    alertModal.confirm(
      "Delete Package",
      "Are you sure you want to remove this package? Clients won't be able to select it anymore.",
      {
        confirmText: "Delete",
        destructive: true,
        onConfirm: async () => {
          try {
            await api.deletePackage(id);
            setPackages((prev) => prev.filter((p) => p.id !== id));
          } catch (error) {
            console.error("Delete package error:", error);
            alertModal.error("Error", "Failed to remove package. Please try again.");
          }
        },
      },
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="My Packages" showBack />
      <FlatList
        data={packages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
        ListHeaderComponent={
          <Text className="text-text-muted text-sm mb-4">
            Offer priced bundles for the service categories you provide — e.g.
            &quot;Deep Clean Package — ₱1500&quot;. Clients can select these
            when booking you.
          </Text>
        }
        ListEmptyComponent={
          <View className="items-center py-16">
            <Ionicons name="pricetags-outline" size={48} color={colors.text.muted} />
            <Text className="text-text-secondary mt-3">
              {loading ? "Loading packages..." : "No packages added yet"}
            </Text>
            {!loading && (
              <Text className="text-text-muted text-sm mt-1">
                Tap + to add your first package
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <PackageCard
            pkg={item}
            onEdit={() => openEditModal(item)}
            onDelete={() => handleDelete(item.id)}
          />
        )}
      />
      <Pressable
        className="absolute bottom-6 right-6 w-14 h-14 bg-accent rounded-full items-center justify-center"
        onPress={openCreateModal}
      >
        <Ionicons name="add" size={28} color={colors.white} />
      </Pressable>

      <Modal visible={showModal} transparent animationType="slide">
        <View className="flex-1 bg-black/40 justify-end">
          <View className="bg-white rounded-t-3xl p-6 pb-8">
            <View className="flex-row justify-between items-center mb-6">
              <Text className="text-text-primary text-xl font-bold">
                {editingId ? "Edit Package" : "Add Package"}
              </Text>
              <Pressable onPress={() => setShowModal(false)}>
                <Ionicons name="close" size={24} color={colors.text.primary} />
              </Pressable>
            </View>

            {myServiceTypes.length === 0 ? (
              <Text className="text-text-secondary text-sm mb-4">
                Add a service category from &quot;My Skills &amp; Services&quot;
                before creating a package.
              </Text>
            ) : (
              <View className="mb-4">
                <Text className="text-text-secondary text-xs mb-2">Service Category</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View className="flex-row gap-2">
                    {myServiceTypes.map((service) => {
                      const isSelected = selectedServiceTypeId === service.id;
                      return (
                        <Pressable
                          key={service.id}
                          onPress={() => setSelectedServiceTypeId(service.id)}
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
                  </View>
                </ScrollView>
              </View>
            )}

            <InputField
              label="Package Name"
              value={name}
              onChangeText={setName}
              placeholder="e.g. Deep Clean Package"
            />
            <InputField
              label="Description (optional)"
              value={description}
              onChangeText={setDescription}
              placeholder="e.g. Includes fridge, oven, and windows"
              multiline
            />
            <InputField
              label="Price (₱)"
              value={price}
              onChangeText={setPrice}
              placeholder="e.g. 1500"
              keyboardType="number-pad"
            />

            <View className="gap-3 mt-2">
              <PrimaryButton
                label={editingId ? "Save Changes" : "Add Package"}
                fullWidth
                onPress={handleSave}
                disabled={saving || myServiceTypes.length === 0}
                loading={saving}
              />
              <OutlinedButton label="Cancel" onPress={() => setShowModal(false)} />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
