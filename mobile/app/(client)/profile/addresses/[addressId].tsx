import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import InputField from "../../../../components/ui/InputField";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import { colors, cardShadow } from "../../../../constants";
import { addressStorage } from "../../../../utils/storage";
import { geocodeAddress, searchAddresses, reverseGeocodeDetailed, formatStructuredAddress, type PlaceResult } from "../../../../utils/geo";
import { getPrecisePosition, LocationPermissionDeniedError, LocationTimeoutError } from "../../../../services/location";
import { useDebouncedCallback } from "../../../../utils/performanceOptimization";
import * as api from "../../../../services/api";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

const LABEL_OPTIONS = ["Home", "Work", "Other"];

export default function AddressEditScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const { addressId } = useLocalSearchParams<{ addressId: string }>();
  const isNew = addressId === "new";

  const [label, setLabel] = useState("Home");
  const [houseNumber, setHouseNumber] = useState("");
  const [street, setStreet] = useState("");
  const [barangay, setBarangay] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [landmark, setLandmark] = useState("");
  const [saving, setSaving] = useState(false);
  const [showManualFields, setShowManualFields] = useState(!isNew);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);

  // Tracks the lat/lng resolved from search/current-location, along with the
  // address text it was resolved for, so `handleSave` can skip a redundant
  // geocode call — but only while the fields still match what was resolved.
  const [resolvedLatLng, setResolvedLatLng] = useState<{ lat: number; lng: number } | null>(null);
  const [resolvedFor, setResolvedFor] = useState<string | null>(null);
  // Only set when resolvedLatLng came from the device's own GPS (not a typed
  // address or a search suggestion) — this is the one case we actually know
  // how accurate the pin is, and it's worth surfacing to the client.
  const [resolvedAccuracy, setResolvedAccuracy] = useState<number | null>(null);

  useEffect(() => {
    const loadExisting = async () => {
      if (!addressId || isNew) return;
      try {
        const addresses = await api.getAddresses();
        const existing = addresses.find((a: any) => a.id === addressId);
        if (existing) {
          setLabel(existing.label ?? "Home");
          setHouseNumber(existing.houseNumber ?? "");
          setStreet(existing.street ?? "");
          setBarangay(existing.barangay ?? "");
          setCity(existing.city ?? "");
          setState(existing.state ?? "");
          setZipCode(existing.zipCode ?? "");
          setLandmark(existing.landmark ?? "");
          if (existing.lat != null && existing.lng != null) {
            setResolvedLatLng({ lat: existing.lat, lng: existing.lng });
            setResolvedFor(
              formatStructuredAddress({
                houseNumber: existing.houseNumber ?? undefined,
                street: existing.street ?? "",
                barangay: existing.barangay ?? undefined,
                city: existing.city ?? "",
                state: existing.state ?? undefined,
                zipCode: existing.zipCode ?? undefined,
              }),
            );
            setResolvedAccuracy(existing.geocodeAccuracy ?? null);
          }
        }
      } catch (error) {
        console.error("Load address error:", error);
      }
    };

    loadExisting();
  }, [addressId, isNew]);

  const runSearch = useDebouncedCallback(async (query: string) => {
    if (query.trim().length < 3) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    try {
      const results = await searchAddresses(query);
      setSearchResults(results);
    } catch (error) {
      console.error("Address search error:", error);
    } finally {
      setSearching(false);
    }
  }, 400);

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    if (text.trim().length < 3) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    runSearch(text);
  };

  const applyResolvedPlace = (place: PlaceResult, accuracy: number | null = null) => {
    const { houseNumber: h, street: s, barangay: b, city: c, state: st, zipCode: z } = place.components ?? {};
    const nextHouseNumber = h ?? "";
    const nextStreet = s ?? "";
    const nextBarangay = b ?? "";
    const nextCity = c ?? "";
    const nextState = st ?? "";
    const nextZip = z ?? "";

    setHouseNumber(nextHouseNumber);
    setStreet(nextStreet);
    setBarangay(nextBarangay);
    setCity(nextCity);
    setState(nextState);
    setZipCode(nextZip);
    setResolvedLatLng(place.geometry.location);
    setResolvedFor(
      formatStructuredAddress({
        houseNumber: nextHouseNumber,
        street: nextStreet,
        barangay: nextBarangay,
        city: nextCity,
        state: nextState,
        zipCode: nextZip,
      }),
    );
    setResolvedAccuracy(accuracy);
    setShowManualFields(true);
    setSearchResults([]);
    setSearchQuery("");
  };

  const handleSelectSuggestion = (place: PlaceResult) => {
    applyResolvedPlace(place);
  };

  const handleUseCurrentLocation = async () => {
    setLocating(true);
    try {
      const position = await getPrecisePosition();
      const place = await reverseGeocodeDetailed(position.lat, position.lng);
      if (place) {
        applyResolvedPlace(place, position.accuracy);
      } else {
        setResolvedLatLng(position);
        setResolvedFor(null);
        setResolvedAccuracy(position.accuracy);
        setShowManualFields(true);
        alertModal.error(
          "Couldn't fill in details",
          "We found your location but couldn't look up the address. Please fill in the fields below.",
        );
      }
    } catch (error) {
      if (error instanceof LocationPermissionDeniedError) {
        alertModal.error("Location needed", "Please enable location access to use your current location.");
      } else if (error instanceof LocationTimeoutError) {
        alertModal.error(
          "Couldn't get a precise fix",
          "GPS is taking too long — try moving near a window or open sky, or enter your address manually.",
        );
      } else {
        alertModal.error("Error", "Unable to get your current location right now.");
      }
    } finally {
      setLocating(false);
    }
  };

  const handleSave = async () => {
    if (!street.trim() || !city.trim() || !state.trim() || !zipCode.trim()) {
      alertModal.error("Error", "Please fill in all address fields.");
      return;
    }

    setSaving(true);
    try {
      const fullAddress = formatStructuredAddress({ houseNumber, street, barangay, city, state, zipCode });
      const isFreshResolution = resolvedLatLng && resolvedFor === fullAddress;
      const geocoded = isFreshResolution
        ? { geometry: { location: resolvedLatLng! } }
        : await geocodeAddress(fullAddress).catch(() => null);
      // Only a device GPS fix carries a real accuracy figure — a fresh
      // free-text geocode (fields were edited since the last resolve) has none.
      const geocodeAccuracy = isFreshResolution ? (resolvedAccuracy ?? undefined) : undefined;

      const payload = {
        label,
        houseNumber: houseNumber || undefined,
        street,
        barangay: barangay || undefined,
        city,
        state,
        zipCode,
        landmark: landmark || undefined,
        lat: geocoded?.geometry.location.lat,
        lng: geocoded?.geometry.location.lng,
        geocodeAccuracy,
      };

      if (isNew) {
        const result = await api.addAddress(payload);
        await addressStorage.upsert(result.id, {
          label,
          address: fullAddress,
          lat: geocoded?.geometry.location.lat,
          lng: geocoded?.geometry.location.lng,
        });
      } else if (addressId) {
        await api.updateAddress(addressId, payload);
        await addressStorage.upsert(addressId, {
          label,
          address: fullAddress,
          lat: geocoded?.geometry.location.lat,
          lng: geocoded?.geometry.location.lng,
        });
      }

      alertModal.success(
        "Success",
        isNew ? "Address added successfully." : "Address updated successfully.",
        [{ text: "OK", onPress: () => router.back() }],
      );
    } catch (error) {
      console.error("Address save error:", error);
      alertModal.error("Error", "Unable to save address right now.");
    } finally {
      setSaving(false);
    }
  };

  const clearResolution = () => {
    setResolvedFor(null);
    setResolvedAccuracy(null);
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title={isNew ? "Add Address" : "Edit Address"} showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
        <View className="items-center mb-5">
          <View className="w-16 h-16 rounded-full bg-accent/10 items-center justify-center">
            <Ionicons name="location-outline" size={30} color={colors.accent.DEFAULT} />
          </View>
        </View>

        {isNew && (
          <>
            <Pressable
              onPress={handleUseCurrentLocation}
              disabled={locating}
              className="flex-row items-center justify-center rounded-2xl py-3.5 mb-3 bg-accent/10"
            >
              {locating ? (
                <ActivityIndicator size="small" color={colors.accent.DEFAULT} />
              ) : (
                <Ionicons name="locate-outline" size={18} color={colors.accent.DEFAULT} />
              )}
              <Text className="text-accent font-semibold ml-2">
                {locating ? "Getting a precise fix..." : "Use my current location"}
              </Text>
            </Pressable>

            <View className="flex-row items-center mb-3">
              <View className="flex-1 h-px bg-divider" />
              <Text className="text-text-muted text-xs mx-3">or search</Text>
              <View className="flex-1 h-px bg-divider" />
            </View>

            <InputField
              label="Search Address"
              value={searchQuery}
              onChangeText={handleSearchChange}
              placeholder="e.g., 123 Rizal Street, Manila"
            />

            {searching && (
              <View className="py-3 items-center">
                <ActivityIndicator size="small" color={colors.brand.DEFAULT} />
              </View>
            )}

            {!searching && searchResults.length > 0 && (
              <View className="mb-4">
                {searchResults.map((place, index) => (
                  <Pressable
                    key={`${place.formatted_address}-${index}`}
                    onPress={() => handleSelectSuggestion(place)}
                    className="bg-white rounded-2xl p-3 mb-2 flex-row items-start"
                    style={cardShadow}
                  >
                    <Ionicons name="location-outline" size={18} color={colors.text.muted} style={{ marginTop: 2 }} />
                    <Text className="text-text-primary text-sm ml-2 flex-1">{place.formatted_address}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            {!showManualFields && (
              <Pressable onPress={() => setShowManualFields(true)} className="items-center py-2 mb-2">
                <Text className="text-text-secondary text-sm underline">Enter address manually instead</Text>
              </Pressable>
            )}
          </>
        )}

        {resolvedAccuracy != null && resolvedFor && (
          <View className="flex-row items-center bg-success/10 rounded-xl px-3 py-2 mb-4">
            <Ionicons name="checkmark-circle" size={16} color={colors.success} />
            <Text className="text-success text-xs font-semibold ml-2">
              Pinned to within ~{Math.round(resolvedAccuracy)}m of your device
            </Text>
          </View>
        )}

        {showManualFields && (
          <>
            <View className="bg-card rounded-2xl p-4 mb-4" style={cardShadow}>
              <Text className="text-text-primary text-sm mb-2 font-semibold">Label</Text>
              <View className="flex-row gap-2">
                {LABEL_OPTIONS.map((l) => (
                  <Pressable
                    key={l}
                    className={`px-4 py-2 rounded-xl ${label === l ? "bg-accent" : "bg-white"}`}
                    onPress={() => setLabel(l)}
                  >
                    <Text
                      className={
                        label === l
                          ? "text-white font-semibold"
                          : "text-text-secondary"
                      }
                    >
                      {l}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <InputField
              label="House / Unit / Bldg. No. (optional)"
              value={houseNumber}
              onChangeText={(text) => {
                setHouseNumber(text);
                clearResolution();
              }}
              placeholder="e.g., Blk 4 Lot 12, Unit 3B"
            />

            <InputField
              label="Street Name"
              value={street}
              onChangeText={(text) => {
                setStreet(text);
                clearResolution();
              }}
              placeholder="e.g., Rizal Street"
            />

            <InputField
              label="Barangay"
              value={barangay}
              onChangeText={(text) => {
                setBarangay(text);
                clearResolution();
              }}
              placeholder="e.g., San Isidro"
            />

            <InputField
              label="City"
              value={city}
              onChangeText={(text) => {
                setCity(text);
                clearResolution();
              }}
              placeholder="e.g., Manila"
            />

            <InputField
              label="State/Province"
              value={state}
              onChangeText={(text) => {
                setState(text);
                clearResolution();
              }}
              placeholder="e.g., Bulacan"
            />

            <InputField
              label="ZIP Code"
              value={zipCode}
              onChangeText={(text) => {
                setZipCode(text);
                clearResolution();
              }}
              placeholder="e.g., 1234"
              keyboardType="number-pad"
            />

            <InputField
              label="Landmark (optional)"
              value={landmark}
              onChangeText={setLandmark}
              placeholder="e.g., Beside Mercury Drug"
            />
          </>
        )}

        <View className="gap-3 mt-2">
          <PrimaryButton
            label={isNew ? "Add Address" : "Save Changes"}
            fullWidth
            loading={saving}
            disabled={saving}
            onPress={handleSave}
          />
          <OutlinedButton label="Cancel" onPress={() => router.back()} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
