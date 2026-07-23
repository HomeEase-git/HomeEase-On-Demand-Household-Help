import React, { useState, useRef, useMemo, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
} from "react-native";
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
import { serviceConfigs } from "../../../../constants/serviceData";
import { getServiceTypes } from "../../../../services/api";
import { calculatePriceBreakdown } from "../../../../utils/pricing";
import type { BottomSheetHandle } from "../../../../components/bottom-sheets/BottomSheetWrapper";
import { colors } from "../../../../constants";
import InvalidationBanner from "../../../../components/ui/InvalidationBanner";

type ServiceTask = {
  id: string;
  name: string;
  description?: string | null;
  basePrice: number;
  durationHours: number;
};

type ServiceType = {
  id: string;
  name: string;
  description?: string | null;
  basePrice: number;
  isActive: boolean;
  tasks: ServiceTask[];
};

export default function BookingStep1Screen() {
  const router = useRouter();
  const draft = useBookingStore((s) => s.draft);
  const setDraft = useBookingStore((s) => s.setDraft);
  const [category, setCategory] = useState<string | null>(draft.category);
  const [description, setDescription] = useState(draft.description);
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [selectedServiceTypeId, setSelectedServiceTypeId] = useState<
    string | null
  >(null);
  const [selectedTask, setSelectedTask] = useState<ServiceTask | null>(null);
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);
  const [loadingServices, setLoadingServices] = useState(false);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const addressSet = !!draft.address;
  const serviceSheetRef = useRef<BottomSheetHandle | null>(null);

  const selectedServiceType = useMemo(() => {
    if (selectedServiceTypeId) {
      return (
        serviceTypes.find((type) => type.id === selectedServiceTypeId) ?? null
      );
    }
    return (
      serviceTypes.find(
        (type) => type.name.toLowerCase() === category?.toLowerCase(),
      ) ?? null
    );
  }, [selectedServiceTypeId, category, serviceTypes]);

  const addOnConfig = useMemo(() => {
    if (!category) return null;
    return serviceConfigs.find(
      (config) => config.categoryName.toLowerCase() === category.toLowerCase(),
    );
  }, [category]);

  useEffect(() => {
    let active = true;

    async function loadServiceTypes() {
      setLoadingServices(true);
      setServiceError(null);

      try {
        const types = await getServiceTypes();
        if (!active) return;
        setServiceTypes(types);
      } catch (error) {
        if (!active) return;
        setServiceError("Unable to load services. Please try again.");
      } finally {
        if (!active) return;
        setLoadingServices(false);
      }
    }

    loadServiceTypes();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setDescription(draft.description);
    setSelectedAddOns(draft.selectedAddOnIds || []);

    if (draft.category && serviceTypes.length) {
      const matchedType = serviceTypes.find(
        (type) => type.name.toLowerCase() === draft.category?.toLowerCase(),
      );
      if (matchedType) {
        setSelectedServiceTypeId(matchedType.id);
      }
    }

    if (draft.selectedTaskId && serviceTypes.length) {
      const matchedType =
        selectedServiceType ||
        serviceTypes.find(
          (type) => type.name.toLowerCase() === draft.category?.toLowerCase(),
        );
      const task = matchedType?.tasks.find(
        (t) => t.id === draft.selectedTaskId,
      );
      setSelectedTask(task || null);
    } else {
      setSelectedTask(null);
    }
  }, [
    draft.category,
    draft.description,
    draft.selectedTaskId,
    draft.selectedAddOnIds,
    serviceTypes,
    selectedServiceType,
  ]);

  const computeEstimatedPrice = (
    task: ServiceTask,
    addOnIds: string[],
    addOnSource: (typeof serviceConfigs)[0],
  ) => {
    const addOnTotal = addOnSource.addOns
      .filter((a) => addOnIds.includes(a.id))
      .reduce((sum, a) => sum + a.price, 0);
    return task.basePrice + addOnTotal;
  };

  const priceBreakdown = useMemo(() => {
    if (!selectedTask || !selectedServiceType || !addOnConfig) return null;
    const addOnTotal = addOnConfig.addOns
      .filter((a) => selectedAddOns.includes(a.id))
      .reduce((sum, a) => sum + a.price, 0);
    return calculatePriceBreakdown(selectedTask.basePrice, 1, addOnTotal, 0);
  }, [selectedTask, selectedServiceType, selectedAddOns, addOnConfig]);

  const unresolvableCategory =
    (draft.entrySource === "worker_profile" ||
      draft.entrySource === "book_again") &&
    category &&
    !selectedServiceType;

  const canNext =
    category &&
    addressSet &&
    (!selectedServiceType || selectedTask !== null) &&
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

        {loadingServices ? (
          <View className="py-6 items-center">
            <ActivityIndicator size="small" />
            <Text className="text-text-secondary mt-2">
              Loading services...
            </Text>
          </View>
        ) : serviceError ? (
          <View className="py-6 items-center">
            <Text className="text-error">{serviceError}</Text>
          </View>
        ) : null}

        {selectedServiceType && (
          <>
            <Text className="text-text-secondary text-sm mb-1 mt-3">
              Select Task
            </Text>
            <ScrollView horizontal={false} className="flex-1">
              {selectedServiceType.tasks.map((task) => (
                <Pressable
                  key={task.id}
                  className={`bg-card rounded-xl p-3 mb-2 flex-row items-center ${
                    selectedTask?.id === task.id
                      ? "border-2 border-accent"
                      : "border-2 border-transparent"
                  }`}
                  onPress={() => {
                    const selected = selectedServiceType.tasks.find(
                      (t) => t.id === task.id,
                    );
                    if (!selected) return;

                    setSelectedTask(selected);
                    setDraft({
                      selectedTaskId: selected.id,
                      estimatedPrice: computeEstimatedPrice(
                        selected,
                        selectedAddOns,
                        addOnConfig ?? serviceConfigs[0],
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

        {selectedServiceType && selectedTask && addOnConfig && (
          <View className="mt-3">
            <AddOnsSelector
              addOns={addOnConfig.addOns}
              selectedIds={selectedAddOns}
              onSelectionChange={(updated) => {
                setSelectedAddOns(updated);
                setDraft({
                  selectedAddOnIds: updated,
                  estimatedPrice: computeEstimatedPrice(
                    selectedTask,
                    updated,
                    addOnConfig,
                  ),
                });
              }}
              showPriceImpact={true}
            />
          </View>
        )}

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
              <View className="flex-row items-center justify-between">
                <View className="flex-1">
                  <Text className="text-primary font-semibold">
                    {draft.workerName ?? "Selected worker"}
                  </Text>
                  <Text className="text-text-secondary text-xs">
                    Worker selected for this booking
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
                    (selectedServiceType ? " and task" : ""),
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
        onSelect={(name, id) => {
          setCategory(name);
          setSelectedTask(null);
          setSelectedAddOns([]);
          setSelectedServiceTypeId(id);
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
