import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, ActivityIndicator, Image, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import StepperHorizontal from "../../../../components/steppers/StepperHorizontal";
import InputField from "../../../../components/ui/InputField";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import InvalidationBanner from "../../../../components/ui/InvalidationBanner";
import ServiceCategorySelector, {
  type ServiceCategoryOption,
} from "../../../../components/booking4step/ServiceCategorySelector";
import RoomSelector from "../../../../components/booking4step/RoomSelector";
import ConditionSelector from "../../../../components/booking4step/ConditionSelector";
import DynamicScopeFields from "../../../../components/booking4step/DynamicScopeFields";
import PricingRangePreview from "../../../../components/booking4step/PricingRangePreview";
import ImageSourcePickerBottomSheet from "../../../../components/bottom-sheets/ImageSourcePickerBottomSheet";
import type { BottomSheetHandle } from "../../../../components/bottom-sheets/BottomSheetWrapper";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import { colors } from "../../../../constants";
import { useBookingStore } from "../../../../store/bookingStore";
import { getServiceTypes, uploadIssuePhoto } from "../../../../services/api";
import { useBookingPriceEstimate } from "../../../../hooks/useBookingPriceEstimate";
import { totalRoomCount } from "../../../../utils/bookingPriceEstimate";
import type { RoomSelection, ConditionType } from "../../../../types/booking4step.types";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

const MAX_ISSUE_PHOTOS = 5;

const BOOKING_STEPS = ["Scope", "Schedule", "Who", "Confirm"];

function hasAnswer(value: string | string[] | undefined): boolean {
  return Array.isArray(value) ? value.length > 0 : !!value && value.trim().length > 0;
}

export default function BookingStep1Screen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const draft = useBookingStore((s) => s.draft);
  const setDraft = useBookingStore((s) => s.setDraft);

  const [categories, setCategories] = useState<ServiceCategoryOption[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<ServiceCategoryOption | null>(null);
  const [rooms, setRooms] = useState<RoomSelection[]>(draft.rooms ?? []);
  const [condition, setCondition] = useState<ConditionType | null>(draft.condition ?? null);
  const [scopeAnswers, setScopeAnswers] = useState<Record<string, string | string[]>>({});
  const [description, setDescription] = useState(draft.description);
  const [issuePhotos, setIssuePhotos] = useState<string[]>(draft.issuePhotoUrls ?? []);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoSheetRef = useRef<BottomSheetHandle | null>(null);

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
          description: t.description,
          scopeType: t.scopeType ?? "ROOM_BASED",
          hasCondition: t.hasCondition ?? true,
          icon: t.icon ?? null,
          scopeFields: Array.isArray(t.scopeFields)
            ? t.scopeFields.map((f: any) => ({
                id: f.id,
                label: f.label,
                fieldType: f.fieldType,
                required: f.required,
                options: Array.isArray(f.options) ? f.options.map((o: any) => ({ id: o.id, label: o.label })) : [],
              }))
            : [],
        }));
        setCategories(options);

        const matched =
          options.find((o) => o.name === draft.serviceType) ??
          options.find((o) => o.name.toLowerCase() === draft.category?.toLowerCase()) ??
          null;
        if (matched) {
          setSelectedCategory(matched);
          // Restore previously-answered custom fields (draft stores them
          // keyed by label; the picker/UI below keys by field id).
          if (matched.scopeType === "CUSTOM" && draft.scopeAnswers) {
            const byLabel = draft.scopeAnswers;
            const restored: Record<string, string | string[]> = {};
            matched.scopeFields.forEach((f) => {
              if (byLabel[f.label] !== undefined) restored[f.id] = byLabel[f.label];
            });
            setScopeAnswers(restored);
          }
        }
      } catch {
        if (active) setLoadError("Unable to load service categories. Please try again.");
      } finally {
        if (active) setLoadingCategories(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const cancel = loadCategories();
    return cancel;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When entering via "Book Now" on a worker's profile, only offer the
  // categories that worker actually provides — picking anything else would
  // leave step-2/step-4 unable to find this worker available at any slot.
  const displayCategories =
    draft.workerLocked && draft.workerServiceTypes && draft.workerServiceTypes.length > 0
      ? categories.filter((c) =>
          draft.workerServiceTypes!.some((ws) => ws.name.toLowerCase() === c.name.toLowerCase())
        )
      : categories;

  const isRoomBased = (selectedCategory?.scopeType ?? "ROOM_BASED") === "ROOM_BASED";
  const showCondition = selectedCategory?.hasCondition ?? true;

  const priceEstimate = useBookingPriceEstimate(selectedCategory?.basePrice ?? 0, 0, undefined, {
    rooms: isRoomBased ? rooms : [],
    condition: showCondition ? condition : null,
    scopeType: selectedCategory?.scopeType ?? null,
  });

  const scopeComplete = !selectedCategory
    ? false
    : isRoomBased
      ? totalRoomCount(rooms) > 0
      : selectedCategory.scopeFields.every((f) => !f.required || hasAnswer(scopeAnswers[f.id]));

  const canNext = !!selectedCategory && scopeComplete && (!showCondition || !!condition);

  const handleCategorySelect = (cat: ServiceCategoryOption) => {
    setSelectedCategory(cat);
    // Switching category can change scope shape entirely — start clean
    // rather than carrying over rooms/answers that no longer apply.
    setRooms([]);
    setScopeAnswers({});
    setCondition(null);
  };

  const handlePickIssuePhoto = async (uri: string) => {
    if (issuePhotos.length >= MAX_ISSUE_PHOTOS) return;
    setUploadingPhoto(true);
    try {
      const { url } = await uploadIssuePhoto(uri);
      setIssuePhotos((prev) => [...prev, url]);
    } catch {
      alertModal.error("Upload failed", "Could not upload that photo. Please try again.");
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
        "Scope incomplete",
        isRoomBased
          ? "Please choose a service, at least one room, and a condition before continuing."
          : "Please choose a service and fill in the required details before continuing."
      );
      return;
    }

    const labelAnswers: Record<string, string | string[]> = {};
    if (!isRoomBased) {
      selectedCategory!.scopeFields.forEach((f) => {
        const value = scopeAnswers[f.id];
        if (hasAnswer(value)) labelAnswers[f.label] = value;
      });
    }

    setDraft({
      category: selectedCategory!.name,
      serviceType: selectedCategory!.name,
      serviceTypeId: draft.workerLocked
        ? (draft.workerServiceTypes?.find((ws) => ws.name.toLowerCase() === selectedCategory!.name.toLowerCase())
            ?.id ?? null)
        : (draft.serviceTypeId ?? null),
      categoryBasePrice: selectedCategory!.basePrice,
      description,
      rooms: isRoomBased ? rooms : [],
      condition: showCondition ? condition : null,
      scopeType: selectedCategory!.scopeType,
      hasCondition: showCondition,
      scopeAnswers: isRoomBased ? {} : labelAnswers,
      issuePhotoUrls: issuePhotos,
    });
    router.push("/(client)/booking/new/step-2");
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="What do you need?" showBack />
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
        <StepperHorizontal steps={BOOKING_STEPS} currentStep={0} />
        <InvalidationBanner />

        {draft.workerLocked && draft.workerName && (
          <View className="bg-accent/10 rounded-2xl p-3 mb-4 flex-row items-center">
            <Text className="text-accent text-sm flex-1">
              Booking directly with <Text className="font-bold">{draft.workerName}</Text>
            </Text>
          </View>
        )}

        <Text className="text-text-primary font-bold text-lg mt-2 mb-3">Service</Text>
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

        {draft.workerLocked && draft.workerServiceTypes && draft.workerServiceTypes.length > 0 && !loadingCategories && displayCategories.length === 0 && (
          <Text className="text-error text-sm mt-2">
            This pro&apos;s listed services aren&apos;t currently bookable. Please go back and pick a different pro.
          </Text>
        )}

        {selectedCategory && isRoomBased && (
          <>
            <Text className="text-text-primary font-bold text-lg mt-6 mb-3">Which rooms?</Text>
            <RoomSelector selection={rooms} onChange={setRooms} />
          </>
        )}

        {selectedCategory && !isRoomBased && (
          <View className="mt-6">
            <DynamicScopeFields
              fields={selectedCategory.scopeFields}
              answers={scopeAnswers}
              onChange={setScopeAnswers}
            />
          </View>
        )}

        {selectedCategory && showCondition && (
          <>
            <Text className="text-text-primary font-bold text-lg mt-6 mb-3">Condition</Text>
            <ConditionSelector value={condition} onChange={setCondition} />
          </>
        )}

        <View className="mt-6">
          <PricingRangePreview estimate={priceEstimate} />
        </View>

        <Text className="text-text-secondary font-bold text-sm mb-1 mt-6">Description (optional)</Text>
        <InputField
          label=""
          value={description}
          onChangeText={(t) => {
            setDescription(t);
          }}
          placeholder="Anything specific the pro should know?"
          multiline
        />

        <View className="flex-row flex-wrap gap-2 mt-3">
          {issuePhotos.map((url) => (
            <View key={url} className="relative">
              <Image source={{ uri: url }} className="w-20 h-20 rounded-xl" />
              <Pressable
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
                  <Ionicons name="camera-outline" size={20} color={colors.text.muted} />
                  <Text className="text-text-secondary text-[10px] mt-1">Add photo</Text>
                </>
              )}
            </Pressable>
          )}
        </View>

        <View className="mt-8">
          <PrimaryButton label="Next" fullWidth disabled={loadingCategories} onPress={handleNext} />
        </View>
      </ScrollView>
      <ImageSourcePickerBottomSheet innerRef={photoSheetRef} onSelect={handlePickIssuePhoto} />
    </SafeAreaView>
  );
}
