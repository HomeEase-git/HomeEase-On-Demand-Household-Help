import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../../components/icons/AppIcon";
import { useRouter, useFocusEffect } from "expo-router";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../components/ui/OutlinedButton";
import LeafletMap from "../../../components/ui/LeafletMap";
import BottomSheetWrapper, {
  BottomSheetHandle,
} from "../../../components/bottom-sheets/BottomSheetWrapper";
import { useBookingStore } from "../../../store/bookingStore";
import { colors } from "../../../constants";
import { cardShadow } from "../../../constants/shadows";
import { addressStorage } from "../../../utils/storage";
import {
  reverseGeocodeDetailed,
  fetchRoute,
  type AddressComponents,
  type LatLng,
  type RouteResult,
} from "../../../utils/geo";
import { getCurrentPosition } from "../../../services/location";

const DEFAULT_LOCATION = {
  lat: 14.5995,
  lng: 120.9842,
  address: "Manila, Philippines",
};

type SavedAddress = {
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
};

export default function AddressPickerScreen() {
  const router = useRouter();
  const draft = useBookingStore((s) => s.draft);
  const setDraft = useBookingStore((s) => s.setDraft);
  const sheetRef = useRef<BottomSheetHandle | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedAddress, setSelectedAddress] = useState(
    draft.address ?? DEFAULT_LOCATION.address,
  );
  const [selectedLocation, setSelectedLocation] = useState<LatLng>({
    lat: draft.lat ?? DEFAULT_LOCATION.lat,
    lng: draft.lng ?? DEFAULT_LOCATION.lng,
  });

  const [currentLocation, setCurrentLocation] = useState<LatLng | null>(null);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [loadingAddresses, setLoadingAddresses] = useState(true);
  const [resolvedComponents, setResolvedComponents] =
    useState<AddressComponents>({});

  const loadSavedAddresses = useCallback(async () => {
    setLoadingAddresses(true);
    try {
      const stored = await addressStorage.list();
      const withCoords = (stored as any[]).filter(
        (item) => typeof item.lat === "number" && typeof item.lng === "number",
      );
      setSavedAddresses(withCoords as SavedAddress[]);
    } finally {
      setLoadingAddresses(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadSavedAddresses();
    }, [loadSavedAddresses]),
  );

  // Preselect the saved address matching the current draft, if any.
  useEffect(() => {
    if (selectedId || !savedAddresses.length) return;
    const match = savedAddresses.find(
      (item) =>
        (draft.address && item.address === draft.address) ||
        (draft.lat != null &&
          draft.lng != null &&
          Math.abs(item.lat - draft.lat) < 0.0001 &&
          Math.abs(item.lng - draft.lng) < 0.0001),
    );
    if (match) {
      setSelectedId(match.id);
      setSelectedAddress(match.address);
      setSelectedLocation({ lat: match.lat, lng: match.lng });
    }
    // Only run this reconciliation as the saved address list becomes available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedAddresses]);

  // Best-effort: silently pick up the device location if permission is
  // already granted, so a route can be drawn without the user having to ask.
  useEffect(() => {
    getCurrentPosition()
      .then(setCurrentLocation)
      .catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;

    if (!currentLocation) {
      setRoute(null);
      return;
    }

    fetchRoute(currentLocation, selectedLocation)
      .then((result) => {
        if (active) setRoute(result);
      })
      .catch(() => {
        if (active) setRoute(null);
      });

    return () => {
      active = false;
    };
  }, [currentLocation, selectedLocation]);

  const handleSelectSaved = async (item: SavedAddress) => {
    setSelectedId(item.id);
    setSelectedAddress(item.address);
    setSelectedLocation({ lat: item.lat, lng: item.lng });
    setResolvedComponents({});
    sheetRef.current?.close();
    const detailed = await reverseGeocodeDetailed(item.lat, item.lng).catch(
      () => null,
    );
    if (detailed?.components) setResolvedComponents(detailed.components);
  };

  const handleConfirm = () => {
    if (!selectedId) return;
    setDraft({
      address: selectedAddress,
      city: resolvedComponents.city || undefined,
      lat: selectedLocation.lat,
      lng: selectedLocation.lng,
    });
    router.back();
  };

  const selectedItem = savedAddresses.find((item) => item.id === selectedId);

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top", "bottom"]}>
      {/* Top half: map + back button only */}
      <View className="flex-1">
        <LeafletMap
          destination={selectedLocation}
          destinationLabel={selectedAddress}
          currentLocation={currentLocation}
          routeCoordinates={route?.coordinates}
        />
        <Pressable
          className="absolute top-4 left-4 w-10 h-10 rounded-full bg-white items-center justify-center"
          style={cardShadow}
          onPress={() => router.back()}
        >
          <Ionicons name="chevron-back" size={22} color={colors.text.primary} />
        </Pressable>
      </View>

      {/* Bottom half: saved address dropdown + actions */}
      <View className="flex-1 px-4 pt-5 pb-4 justify-between">
        <View>
          <Text className="text-text-secondary text-sm mb-2">
            Saved Address
          </Text>
          <Pressable
            className="bg-card rounded-xl p-4 flex-row items-center justify-between"
            onPress={() => sheetRef.current?.expand()}
          >
            <View className="flex-1 mr-2">
              {selectedItem ? (
                <>
                  <Text className="text-brand font-semibold">
                    {selectedItem.label}
                  </Text>
                  <Text
                    className="text-text-secondary text-xs mt-0.5"
                    numberOfLines={1}
                  >
                    {selectedItem.address}
                  </Text>
                </>
              ) : (
                <Text className="text-text-muted">
                  {loadingAddresses
                    ? "Loading addresses..."
                    : savedAddresses.length
                      ? "Select a saved address"
                      : "No saved addresses yet"}
                </Text>
              )}
            </View>
            <Ionicons name="chevron-down" size={20} color={colors.text.muted} />
          </Pressable>
        </View>

        <View className="gap-3">
          <OutlinedButton
            label="Add Address"
            onPress={() => router.push("/(client)/profile/addresses/new")}
          />
          <PrimaryButton
            label="Confirm"
            fullWidth
            disabled={!selectedItem}
            onPress={handleConfirm}
          />
        </View>
      </View>

      <BottomSheetWrapper
        innerRef={sheetRef}
        snapPoints={["50%"]}
        title="Saved Addresses"
      >
        <ScrollView className="max-h-64">
          {savedAddresses.length === 0 ? (
            <Text className="text-text-secondary text-sm py-4 text-center">
              {loadingAddresses
                ? "Loading addresses..."
                : "You have no saved addresses yet. Tap “Add Address” to create one."}
            </Text>
          ) : (
            savedAddresses.map((item) => (
              <Pressable
                key={item.id}
                className={`bg-card-light rounded-xl py-3 px-4 mb-2 flex-row items-center ${
                  selectedId === item.id ? "border-2 border-accent" : "border-2 border-transparent"
                }`}
                onPress={() => handleSelectSaved(item)}
              >
                <Ionicons
                  name="bookmark-outline"
                  size={16}
                  color={colors.brand.DEFAULT}
                />
                <View className="ml-3 flex-1">
                  <Text className="text-brand font-semibold">{item.label}</Text>
                  <Text
                    className="text-text-secondary text-xs mt-0.5"
                    numberOfLines={1}
                  >
                    {item.address}
                  </Text>
                </View>
              </Pressable>
            ))
          )}
        </ScrollView>
      </BottomSheetWrapper>
    </SafeAreaView>
  );
}
