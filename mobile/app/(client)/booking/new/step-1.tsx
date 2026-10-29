import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, ActivityIndicator, Pressable, Switch } from "react-native";
import { RemoteImage } from "../../../../components/ui/RemoteImage";
import { KeyboardAwareScrollView } from "../../../../components/ui/KeyboardAwareScrollView";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ScreenHeader } from "../../../../components/ui/ScreenHeader";
import { StepperHorizontal } from "../../../../components/steppers/StepperHorizontal";
import { InputField } from "../../../../components/ui/InputField";
import { OutlinedButton } from "../../../../components/ui/OutlinedButton";
import InvalidationBanner from "../../../../components/ui/InvalidationBanner";
import ServiceCategorySelector, {
  type ServiceCategoryOption,
} from "../../../../components/booking4step/ServiceCategorySelector";
import TaskSelector from "../../../../components/booking4step/TaskSelector";
import {
  PET_FRIENDLY_PRIORITY,
  type ServiceTaskOption,
} from "../../../../types/booking4step.types";
import PricingRangePreview from "../../../../components/booking4step/PricingRangePreview";
import PackageSelector from "../../../../components/booking4step/PackageSelector";
import { BookingFooterBar } from "../../../../components/booking4step/BookingFooterBar";
import { ImageSourcePickerBottomSheet } from "../../../../components/bottom-sheets/ImageSourcePickerBottomSheet";
import type { BottomSheetHandle } from "../../../../components/bottom-sheets/BottomSheetWrapper";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import { colors } from "../../../../constants";
import { useBookingStore } from "../../../../store/bookingStore";
import { getServiceTypes, uploadIssuePhoto } from "../../../../services/api";
import { useBookingPriceEstimate } from "../../../../hooks/useBookingPriceEstimate";
import { useAlertModal } from "../../../../contexts/AlertModalContext";
import { pluralUnit } from "../../../../utils/pricing";

const MAX_ISSUE_PHOTOS = 5;

const BOOKING_STEPS = ["Service", "When & where", "Book"];

export default function BookingStep1Screen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const draft = useBookingStore((s) => s.draft);
  const setDraft = useBookingStore((s) => s.setDraft);

  const [categories, setCategories] = useState<ServiceCategoryOption[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] =
    useState<ServiceCategoryOption | null>(null);
  const [selectedTask, setSelectedTask] = useState<ServiceTaskOption | null>(
    null,
  );
  const [quantityText, setQuantityText] = useState(
    draft.quantity != null ? String(draft.quantity) : "",
  );
  const [description, setDescription] = useState(draft.description);
  const [issuePhotos, setIssuePhotos] = useState<string[]>(
    draft.issuePhotoUrls ?? [],
  );
  const [hasPets, setHasPets] = useState<boolean>(
    (draft.priorities ?? []).includes(PET_FRIENDLY_PRIORITY),
  );
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoSheetRef = useRef<BottomSheetHandle | null>(null);
  const initialDraft = useRef(draft);

  const loadCategories = useCallback(() => {
    let active = true;
    (async () => {
      setLoadingCategories(true);
      setLoadError(null);
      try {
        const types = await getServiceTypes();
        if (!active) return;
        const options: ServiceCategoryOption[] = types.map((t: any) => ({
          id: t.id,
          name: t.name,
          basePrice: t.basePrice,
          priceRangeMin:
            typeof t.priceRangeMin === "number" ? t.priceRangeMin : t.basePrice,
          priceRangeMax:
            typeof t.priceRangeMax === "number" ? t.priceRangeMax : t.basePrice,
          description: t.description,
          icon: t.icon ?? null,
          tasks: Array.isArray(t.tasks)
            ? t.tasks
                .filter((task: any) => task.isActive)
                .map((task: any) => ({
                  id: task.id,
                  name: task.name,
                  description: task.description ?? null,
                  basePrice: task.basePrice,
                  pricingModel: task.pricingModel,
                  minPrice: task.basePrice,
                  maxPrice: task.basePrice,
                  unitLabel: task.unitLabel ?? null,
                  minQuantity: task.minQuantity ?? null,
                  maxQuantity: task.maxQuantity ?? null,
                  isActive: task.isActive,
                }))
            : [],
        }));
        setCategories(options);

        const { serviceType, category, serviceTaskId } = initialDraft.current;
        const matched =
          options.find((o) => o.name === serviceType) ??
          options.find(
            (o) => o.name.toLowerCase() === category?.toLowerCase(),
          ) ??
          null;
        if (matched) {
          setSelectedCategory(matched);
          if (serviceTaskId) {
            const matchedTask = matched.tasks.find(
              (task) => task.id === serviceTaskId,
            );
            if (matchedTask) setSelectedTask(matchedTask);
          }
        }
      } catch {
        if (active)
          setLoadError("Unable to load service categories. Please try again.");
      } finally {
        if (active) setLoadingCategories(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => loadCategories(), [loadCategories]);

  const displayCategories =
    draft.workerLocked &&
    draft.workerServiceTypes &&
    draft.workerServiceTypes.length > 0
      ? categories
          .filter((c) =>
            draft.workerServiceTypes!.some(
              (ws) => ws.name.toLowerCase() === c.name.toLowerCase(),
            ),
          )
          .map((c) => {
            const workerService = draft.workerServiceTypes!.find(
              (ws) => ws.name.toLowerCase() === c.name.toLowerCase(),
            );
            return workerService?.priceRangeMin != null &&
              workerService?.priceRangeMax != null
              ? {
                  ...c,
                  priceRangeMin: workerService.priceRangeMin,
                  priceRangeMax: workerService.priceRangeMax,
                }
              : c;
          })
      : categories;

  const activeTasks = selectedCategory?.tasks ?? [];
  const requiresTaskSelection = activeTasks.length > 0;

  const isPerUnit =
    selectedTask?.pricingModel === "PER_UNIT" ||
    selectedTask?.pricingModel === "TIERED";
  const minQuantity = Math.max(1, selectedTask?.minQuantity ?? 1);
  const maxQuantity = selectedTask?.maxQuantity ?? null;
  const quantity = Number(quantityText);
  const quantityError =
    !isPerUnit || !quantityText.trim()
      ? null
      : !Number.isFinite(quantity) || quantity < minQuantity
        ? `At least ${minQuantity}`
        : maxQuantity != null && quantity > maxQuantity
          ? `At most ${maxQuantity}`
          : null;
  const quantityComplete =
    !isPerUnit || (!!quantityText.trim() && !quantityError);

  const priceEstimate = useBookingPriceEstimate(
    {
      min: selectedTask
        ? (selectedTask.minPrice ?? 0)
        : (selectedCategory?.priceRangeMin ?? 0),
      max: selectedTask
        ? (selectedTask.maxPrice ?? 0)
        : (selectedCategory?.priceRangeMax ?? 0),
    },
    0,
    undefined,
    isPerUnit
      ? {
          quantity: quantityComplete ? quantity : undefined,
          unitLabel: selectedTask?.unitLabel,
        }
      : undefined,
  );

  const taskComplete = !requiresTaskSelection || !!selectedTask;

  const canNext = !!selectedCategory && taskComplete && quantityComplete;

  const handleCategorySelect = (cat: ServiceCategoryOption) => {
    setSelectedCategory(cat);
    setSelectedTask(null);
    setQuantityText("");
  };

  const handleTaskSelect = (task: ServiceTaskOption) => {
    setSelectedTask(task);
    setQuantityText("");
  };

  const handlePickIssuePhoto = async (uri: string) => {
    if (issuePhotos.length >= MAX_ISSUE_PHOTOS) return;
    setUploadingPhoto(true);
    try {
      const { url } = await uploadIssuePhoto(uri);
      setIssuePhotos((prev) => [...prev, url]);
    } catch {
      alertModal.error(
        "Upload failed",
        "Could not upload that photo. Please try again.",
      );
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleRemoveIssuePhoto = (url: string) => {
    setIssuePhotos((prev) => prev.filter((u) => u !== url));
  };

  const handleNext = () => {
    if (!canNext) {
      alertModal.warning(
        "Almost there",
        isPerUnit && !quantityComplete
          ? "Enter how many you need."
          : "Please choose a service before continuing.",
      );
      return;
    }

    setDraft({
      category: selectedCategory!.name,
      serviceType: selectedCategory!.name,
      serviceTypeId: draft.workerLocked
        ? (draft.workerServiceTypes?.find(
            (ws) =>
              ws.name.toLowerCase() === selectedCategory!.name.toLowerCase(),
          )?.id ?? null)
        : (draft.serviceTypeId ?? null),
      categoryBasePrice: selectedCategory!.basePrice,
      categoryPriceRangeMin: selectedCategory!.priceRangeMin,
      categoryPriceRangeMax: selectedCategory!.priceRangeMax,
      serviceTaskId: selectedTask?.id ?? null,
      selectedTaskName: selectedTask?.name ?? null,
      // Retired TIERED rows are priced per unit too (backend isPerUnitModel).
      selectedTaskPricingModel: isPerUnit ? "PER_UNIT" : (selectedTask?.pricingModel ?? null),
      selectedTaskUnitLabel:
        selectedTask?.pricingModel === "PER_UNIT" ||
        selectedTask?.pricingModel === "TIERED"
          ? (selectedTask.unitLabel ?? null)
          : null,
      selectedTaskPriceRangeMin: selectedTask?.minPrice ?? null,
      selectedTaskPriceRangeMax: selectedTask?.maxPrice ?? null,
      selectedTaskMinQuantity: isPerUnit
        ? (selectedTask?.minQuantity ?? null)
        : null,
      selectedTaskMaxQuantity: isPerUnit
        ? (selectedTask?.maxQuantity ?? null)
        : null,
      description,
      quantity: isPerUnit ? quantity : null,
      issuePhotoUrls: issuePhotos,
    });
    router.push("/(client)/booking/new/step-2");
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="What do you need?" showBack />
      <KeyboardAwareScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 24, paddingBottom: 40 }}
      >
        <StepperHorizontal steps={BOOKING_STEPS} currentStep={0} />
        <InvalidationBanner />

        {draft.workerLocked && draft.workerName && (
          <View className="bg-accent/10 rounded-2xl p-3 mb-4 flex-row items-center">
            <Text className="text-accent text-sm flex-1">
              Booking directly with{" "}
              <Text className="font-bold">{draft.workerName}</Text>
            </Text>
          </View>
        )}

        <Text className="text-text-primary font-bold text-lg mt-2 mb-3">
          Service
        </Text>
        {loadError ? (
          <View className="py-6 items-center">
            <Text className="text-error mb-3">{loadError}</Text>
            <OutlinedButton label="Retry" onPress={loadCategories} />
          </View>
        ) : (
          <ServiceCategorySelector
            categories={displayCategories}
            selectedId={selectedCategory?.id ?? null}
            loading={loadingCategories}
            onSelect={handleCategorySelect}
          />
        )}

        {draft.workerLocked &&
          draft.workerServiceTypes &&
          draft.workerServiceTypes.length > 0 &&
          !loadingCategories &&
          displayCategories.length === 0 && (
            <Text className="text-error text-sm mt-2">
              This worker&apos;s listed services aren&apos;t currently bookable.
              Please go back and pick a different worker.
            </Text>
          )}

        {selectedCategory && requiresTaskSelection && (
          <View className="mt-6">
            <Text className="text-text-primary font-bold text-lg mb-3">
              What specifically?
            </Text>
            <TaskSelector
              tasks={activeTasks}
              selectedId={selectedTask?.id ?? null}
              onSelect={handleTaskSelect}
            />
          </View>
        )}

        {isPerUnit && (
          <View className="mt-6">
            <Text className="text-text-primary font-bold text-lg mb-1">
              How many?
            </Text>
            <Text className="text-text-muted text-sm mb-2">
              Priced per {selectedTask!.unitLabel || "unit"}
              {maxQuantity != null
                ? ` · ${minQuantity} to ${maxQuantity}`
                : minQuantity > 1
                  ? ` · at least ${minQuantity}`
                  : ""}
            </Text>
            <InputField
              label=""
              value={quantityText}
              onChangeText={(t) => setQuantityText(t.replace(/[^0-9.]/g, ""))}
              placeholder={`Number of ${pluralUnit(selectedTask!.unitLabel || "unit")}`}
              keyboardType="decimal-pad"
              error={quantityError}
            />
          </View>
        )}

        <View className="mt-6">
          <PricingRangePreview estimate={priceEstimate} />
        </View>

        {selectedCategory && draft.workerLocked && draft.workerId && (
          <View className="mt-6">
            <Text className="text-text-primary font-bold text-lg mb-3">
              {draft.workerName
                ? `${draft.workerName}'s packages (optional)`
                : "Packages (optional)"}
            </Text>
            <PackageSelector
              workerId={draft.workerId}
              serviceTypeId={
                draft.workerServiceTypes?.find(
                  (ws) =>
                    ws.name.toLowerCase() ===
                    selectedCategory.name.toLowerCase(),
                )?.id ?? null
              }
              selected={draft.selectedPackageIds ?? []}
              onChange={(ids) => setDraft({ selectedPackageIds: ids })}
              onSelectedTotalChange={(total) =>
                setDraft({ selectedPackagesTotal: total })
              }
            />
          </View>
        )}

        <View className="bg-card rounded-xl p-3.5 flex-row items-center mt-6">
          <View className="flex-1 pr-3">
            <Text className="text-text-primary font-semibold text-base">
              I have pets at home
            </Text>
            <Text className="text-text-muted text-sm mt-0.5">
              We&apos;ll match you with a pet-friendly worker
            </Text>
          </View>
          <Switch
            value={hasPets}
            onValueChange={(value) => {
              setHasPets(value);
              setDraft({ priorities: value ? [PET_FRIENDLY_PRIORITY] : [] });
            }}
            trackColor={{
              false: colors.toggleOff,
              true: colors.accent.DEFAULT,
            }}
            thumbColor={colors.white}
          />
        </View>

        <Text className="text-text-secondary font-bold text-sm mb-1 mt-6">
          Description (optional)
        </Text>
        <InputField
          label=""
          value={description}
          onChangeText={(t) => {
            setDescription(t);
          }}
          placeholder="Anything specific the worker should know?"
          multiline
        />

        <View className="flex-row flex-wrap gap-2 mt-3">
          {issuePhotos.map((url) => (
            <View key={url} className="relative">
              <RemoteImage
                source={{ uri: url }}
                className="w-20 h-20 rounded-xl"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove photo"
                hitSlop={8}
                className="absolute -top-1.5 -right-1.5 bg-black/70 rounded-full w-5 h-5 items-center justify-center"
                onPress={() => handleRemoveIssuePhoto(url)}
              >
                <Ionicons name="close" size={12} color="#fff" />
              </Pressable>
            </View>
          ))}
          {issuePhotos.length < MAX_ISSUE_PHOTOS && (
            <Pressable
              className="w-20 h-20 rounded-xl border border-dashed items-center justify-center"
              style={{ borderColor: colors.divider }}
              onPress={() => photoSheetRef.current?.expand()}
              disabled={uploadingPhoto}
            >
              {uploadingPhoto ? (
                <ActivityIndicator size="small" />
              ) : (
                <>
                  <Ionicons
                    name="camera-outline"
                    size={20}
                    color={colors.text.muted}
                  />
                  <Text className="text-text-secondary text-xs mt-1">
                    Add photo
                  </Text>
                </>
              )}
            </Pressable>
          )}
        </View>
      </KeyboardAwareScrollView>
      <BookingFooterBar
        estimate={selectedCategory ? priceEstimate : null}
        buttonLabel="Next"
        disabled={loadingCategories}
        onPress={handleNext}
      />
      <ImageSourcePickerBottomSheet
        innerRef={photoSheetRef}
        onSelect={handlePickIssuePhoto}
      />
    </SafeAreaView>
  );
}
