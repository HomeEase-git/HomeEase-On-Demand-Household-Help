import React, { useState, useRef, useMemo, useEffect } from "react";
import { View, Text, ScrollView, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import StepperHorizontal from "../../../../components/steppers/StepperHorizontal";
import InputField from "../../../../components/ui/InputField";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import PriceBreakdownCard from "../../../../components/ui/PriceBreakdown";
import AddOnsSelector from "../../../../components/ui/AddOnsSelector";
import ServiceTypePickerBottomSheet from "../../../../components/bottom-sheets/ServiceTypePickerBottomSheet";
import { useBookingStore } from "../../../../store/bookingStore";
import { workers } from "../../../../constants/dummyData";
import {
  serviceConfigs,
  type ServiceTask,
  type ServiceConfig,
} from "../../../../constants/serviceData";
import { calculatePriceBreakdown } from "../../../../utils/pricing";
import type { BottomSheetHandle } from "../../../../components/bottom-sheets/BottomSheetWrapper";
import { colors } from "../../../../constants";
import InvalidationBanner from "../../../../components/ui/InvalidationBanner";

export default function BookingStep1Screen() {
  const router = useRouter();
  const draft = useBookingStore((s) => s.draft);
  const setDraft = useBookingStore((s) => s.setDraft);
  const [category, setCategory] = useState<string | null>(draft.category);
  const [description, setDescription] = useState(draft.description);
  const [selectedTask, setSelectedTask] = useState<ServiceTask | null>(null);
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);
  const addressSet = !!draft.address;
  const serviceSheetRef = useRef<BottomSheetHandle | null>(null);

  // Hydrate local state from draft on mount and whenever draft changes
  useEffect(() => {
    setCategory(draft.category);
    setDescription(draft.description);
    setSelectedAddOns(draft.selectedAddOnIds || []);

    // Resolve selectedTask from draft.selectedTaskId
    if (draft.selectedTaskId && draft.category) {
      const config = serviceConfigs.find(
        (c) => c.categoryName.toLowerCase() === draft.category?.toLowerCase(),
      );
      const task = config?.tasks.find((t) => t.id === draft.selectedTaskId);
      setSelectedTask(task || null);
    } else {
      setSelectedTask(null);
    }
  }, [
    draft.category,
    draft.description,
    draft.selectedTaskId,
    draft.selectedAddOnIds,
  ]);

  // Find matching service config for the selected category
  const serviceConfig = useMemo(() => {
    if (!category) return null;
    return serviceConfigs.find(
      (config) => config.categoryName.toLowerCase() === category.toLowerCase(),
    );
  }, [category]);

  // Compute estimated price using utility
  const computeEstimatedPrice = (
    task: ServiceTask,
    addOnIds: string[],
    config: ServiceConfig,
  ) => {
    const addOnTotal = config.addOns
      .filter((a) => addOnIds.includes(a.id))
      .reduce((sum, a) => sum + a.price, 0);
    return task.basePrice + addOnTotal;
  };

  // Get full price breakdown
  const priceBreakdown = useMemo(() => {
    if (!selectedTask || !serviceConfig) return null;
    const addOnTotal = serviceConfig.addOns
      .filter((a) => selectedAddOns.includes(a.id))
      .reduce((sum, a) => sum + a.price, 0);
    return calculatePriceBreakdown(selectedTask.basePrice, 1, addOnTotal, 0);
  }, [selectedTask, serviceConfig, selectedAddOns]);

  // Guard: if entrySource is worker_profile or book_again and category doesn't resolve,
  // show error and prevent navigation (prevents silent data corruption)
  const unresolvableCategory =
    (draft.entrySource === "worker_profile" ||
      draft.entrySource === "book_again") &&
    category &&
    !serviceConfig;

  const canNext =
    category &&
    addressSet &&
    (!serviceConfig || selectedTask !== null) &&
    !unresolvableCategory;

  return (
    <SafeAreaView className="flex-1 bg-primary-white">
      <ScreenHeader title="Book a Service" showBack />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 24, paddingBottom: 40 }}
      >
        <StepperHorizontal
          steps={["Service", "Schedule", "Payment"]}
          currentStep={0}
        />
        <InvalidationBanner />
        {unresolvableCategory && (
          <View className="bg-error/10 border border-error/30 rounded-2xl p-4 mb-4 flex-row items-start">
            <Ionicons
              name="alert-circle"
              size={20}
              color={colors.error}
              style={{ marginTop: 2, marginRight: 8 }}
            />
            <View className="flex-1">
              <Text className="text-error font-bold text-sm">
                Booking unavailable
              </Text>
              <Text className="text-error text-xs mt-1">
                The service could not be matched to a bookable category. Please
                start a new booking.
              </Text>
            </View>
          </View>
        )}
        <Text className="text-primary font-bold text-lg mt-4">
          Service Details
        </Text>

        <Pressable
          className="bg-card rounded-xl p-4 mt-3 flex-row items-center justify-between"
          onPress={() => serviceSheetRef.current?.expand()}
        >
          <Text
            className={
              category ? "text-primary font-semibold" : "text-text-muted"
            }
          >
            {category ?? "Select service category"}
          </Text>
          <Ionicons name="chevron-down" size={20} color={colors.text.muted} />
        </Pressable>

        {/* Task Selection */}
        {serviceConfig && (
          <>
            <Text className="text-text-secondary text-sm mb-1 mt-3">
              Select Task
            </Text>
            <ScrollView horizontal={false} className="flex-1">
              {serviceConfig.tasks.map((task) => (
                <Pressable
                  key={task.id}
                  className={`bg-card rounded-xl p-3 mb-2 flex-row items-center ${
                    selectedTask?.id === task.id
                      ? "border-2 border-accent"
                      : "border-2 border-transparent"
                  }`}
                  onPress={() => {
                    setSelectedTask(task);
                    setDraft({
                      selectedTaskId: task.id,
                      estimatedPrice: computeEstimatedPrice(
                        task,
                        selectedAddOns,
                        serviceConfig,
                      ),
                    });
                  }}
                >
                  <View className="flex-1">
                    <Text className="text-primary font-semibold">
                      {task.name}
                    </Text>
                    <Text className="text-text-secondary text-xs mt-0.5">
                      {task.description}
                    </Text>
                  </View>
                  <View className="items-end ml-3">
                    <Text className="text-accent font-semibold">
                      ₱{task.basePrice}
                    </Text>
                    <Text className="text-text-muted text-xs">
                      {task.durationHours}hr{task.durationHours > 1 ? "s" : ""}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}

        {/* Add-ons Selection */}
        {serviceConfig && selectedTask && (
          <View className="mt-3">
            <AddOnsSelector
              addOns={serviceConfig.addOns}
              selectedIds={selectedAddOns}
              onSelectionChange={(updated) => {
                setSelectedAddOns(updated);
                setDraft({
                  selectedAddOnIds: updated,
                  estimatedPrice: computeEstimatedPrice(
                    selectedTask,
                    updated,
                    serviceConfig,
                  ),
                });
              }}
              showPriceImpact={true}
            />
          </View>
        )}

        {/* Price Estimate Card */}
        {priceBreakdown && (
          <View className="mt-3">
            <PriceBreakdownCard breakdown={priceBreakdown} detailed={false} />
          </View>
        )}

        <InputField
          label="Description"
          value={description}
          onChangeText={(t) => {
            setDescription(t);
            setDraft({ description: t });
          }}
          placeholder="Describe what you need..."
          multiline
        />

        <Text className="text-text-secondary text-sm mb-1">Address</Text>
        <Pressable
          className="bg-card rounded-xl p-4 flex-row items-center"
          onPress={() => router.push("/(client)/booking/address-picker")}
        >
          <Ionicons
            name="location-outline"
            size={20}
            color={colors.accent.DEFAULT}
          />
          <Text
            className={
              addressSet
                ? "text-primary ml-3 flex-1"
                : "text-text-muted ml-3 flex-1"
            }
          >
            {addressSet ? draft.address! : "Tap to set your location"}
          </Text>
        </Pressable>

        <View className="mt-4">
          <Text className="text-text-secondary text-sm mb-1">
            Preferred Worker
          </Text>
          <View className="bg-card rounded-2xl p-4">
            {draft.workerId ? (
              (() => {
                const selectedWorker = workers.find(
                  (w) => w.id === draft.workerId,
                );
                return selectedWorker ? (
                  <View className="flex-row items-center justify-between">
                    <View className="flex-1">
                      <Text className="text-primary font-semibold">
                        {selectedWorker.name}
                      </Text>
                      <Text className="text-text-secondary text-xs">
                        {selectedWorker.service} · ₱{selectedWorker.rate}/hr
                      </Text>
                    </View>
                    <OutlinedButton
                      label="Change"
                      onPress={() => {
                        if (draft.workerLocked) {
                          Alert.alert(
                            "Worker Locked",
                            "This worker was selected from their profile or a previous booking and can't be changed from here. Please go back to change the service or booking.",
                          );
                          return;
                        }
                        router.push("/(client)/booking/select-worker");
                      }}
                    />
                  </View>
                ) : null;
              })()
            ) : (
              <View>
                <Text className="text-text-secondary text-sm mb-3">
                  Please choose a specific worker for your booking.
                </Text>
                <OutlinedButton
                  label="Choose a Worker"
                  onPress={() => router.push("/(client)/booking/select-worker")}
                />
              </View>
            )}
          </View>
        </View>

        <View className="mt-8">
          <PrimaryButton
            label="Next"
            fullWidth
            disabled={!canNext}
            onPress={() => {
              if (!canNext) {
                Alert.alert(
                  "Error",
                  "Please select category and address" +
                    (serviceConfig ? " and task" : ""),
                );
                return;
              }
              setDraft({ category, description });
              router.push("/(client)/booking/new/step-2");
            }}
          />
        </View>
      </ScrollView>
      <ServiceTypePickerBottomSheet
        innerRef={serviceSheetRef}
        onSelect={(name) => {
          setCategory(name);
          setSelectedTask(null);
          setSelectedAddOns([]);
          setDraft({
            category: name,
            selectedTaskId: null,
            selectedAddOnIds: [],
            estimatedPrice: 0,
          });
          serviceSheetRef.current?.close();
        }}
      />
    </SafeAreaView>
  );
}
