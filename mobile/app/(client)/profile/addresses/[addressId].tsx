import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, ActivityIndicator, Linking } from "react-native";
import { KeyboardAwareScrollView } from "../../../../components/ui/KeyboardAwareScrollView";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import InputField from "../../../../components/ui/InputField";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import { colors, cardShadow } from "../../../../constants";
import { addressStorage } from "../../../../utils/storage";
import * as Location from "expo-location";
import {
  autocompleteAddresses,
  getPlaceDetails,
  isInPhilippines,
  newPlacesSessionToken,
  reverseGeocodeDetailed,
  displayAddress,
  stripCountry,
  type AddressComponents,
  type AddressSuggestion,
  type LatLng,
  type PlaceResult,
} from "../../../../utils/geo";
import { useDebouncedCallback } from "../../../../utils/performanceOptimization";
import * as api from "../../../../services/api";
import { useAlertModal } from "../../../../contexts/AlertModalContext";
import LocationPickerMap, {
  type LocationPickerMapHandle,
} from "../../../../components/ui/LocationPickerMap";

const LABEL_OPTIONS = ["Home", "Work", "Other"];

// The address is one free-text line plus the map pin. The pin (lat/lng) is the
// location — bookings, distance fees and the worker's navigation all use it —
// so the text is never geocoded; it's just what the client and worker read.
// Google's structured parts for the pinned spot ride along silently (city is
// what bookings are grouped by in admin reports).
export default function AddressEditScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const { addressId } = useLocalSearchParams<{ addressId: string }>();
  const isNew = addressId === "new";

  const [label, setLabel] = useState("Home");
  const [fullAddress, setFullAddress] = useState("");
  const [landmark, setLandmark] = useState("");
  const [pin, setPin] = useState<LatLng | null>(null);
  const [components, setComponents] = useState<AddressComponents>({});
  // True when the pin is only an area's center (a search result for a whole
  // barangay or city), so the client is nudged to drag it to their gate.
  const [approximate, setApproximate] = useState(false);
  // Once the client has typed in the address box, moving the pin no longer
  // overwrites their text — it's offered instead (see pinAddressOffer).
  const [textEdited, setTextEdited] = useState(false);
  const [pinAddressOffer, setPinAddressOffer] = useState<PlaceResult | null>(
    null,
  );
  const [saving, setSaving] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AddressSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [resolvingPlaceId, setResolvingPlaceId] = useState<string | null>(null);
  const pickerMapRef = useRef<LocationPickerMapHandle>(null);

  // One Places Autocomplete session = every keystroke + the Place Details
  // call for the suggestion picked, billed as a single lookup. Created on the
  // first keystroke, dropped once a suggestion is resolved.
  const sessionTokenRef = useRef<string | null>(null);
  // The latest query typed — a slow response for an older query must not
  // overwrite suggestions for what's in the box now.
  const latestQueryRef = useRef("");
  // Where the device last was (only if location permission was ALREADY
  // granted — never prompts), to rank nearby suggestions first.
  const searchBiasRef = useRef<LatLng | undefined>(undefined);

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted") return;
        const last = await Location.getLastKnownPositionAsync();
        if (last)
          searchBiasRef.current = {
            lat: last.coords.latitude,
            lng: last.coords.longitude,
          };
      } catch {
        // Bias is a nice-to-have; search works without it.
      }
    })();
  }, []);

  useEffect(() => {
    const loadExisting = async () => {
      if (!addressId || isNew) return;
      try {
        const addresses = await api.getAddresses();
        const existing = addresses.find((a: any) => a.id === addressId);
        if (!existing) return;
        setLabel(existing.label ?? "Home");
        setFullAddress(displayAddress(existing));
        setTextEdited(true);
        setLandmark(existing.landmark ?? "");
        setComponents({
          houseNumber: existing.houseNumber ?? undefined,
          street: existing.street || undefined,
          barangay: existing.barangay ?? undefined,
          city: existing.city || undefined,
          state: existing.state ?? undefined,
          zipCode: existing.zipCode ?? undefined,
        });
        if (existing.lat != null && existing.lng != null) {
          const saved = { lat: existing.lat, lng: existing.lng };
          setPin(saved);
          pickerMapRef.current?.animateTo(saved);
        }
      } catch (error) {
        console.error("Load address error:", error);
        alertModal.error("Error", "Couldn't load this address. Please go back and try again.");
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
      if (!sessionTokenRef.current)
        sessionTokenRef.current = newPlacesSessionToken();
      const results = await autocompleteAddresses(
        query,
        sessionTokenRef.current,
        searchBiasRef.current,
      );
      if (latestQueryRef.current === query) setSearchResults(results);
    } catch (error) {
      console.error("Address search error:", error);
    } finally {
      setSearching(false);
    }
  }, 400);

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    latestQueryRef.current = text;
    if (text.trim().length < 3) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    runSearch(text);
  };

  const applyPlaceAddress = (place: PlaceResult) => {
    setFullAddress(stripCountry(place.formatted_address));
    setComponents(place.components ?? {});
    setTextEdited(false);
    setPinAddressOffer(null);
  };

  const handleMapLocationSelected = (
    location: LatLng,
    place: PlaceResult | null,
  ) => {
    // A drag or GPS fix is the client putting the pin exactly where they are.
    setPin(location);
    setApproximate(false);
    if (!place) return;
    if (textEdited && fullAddress.trim()) {
      // Keep what they typed; the parts still follow the pin.
      setComponents(place.components ?? {});
      setPinAddressOffer(place);
    } else {
      applyPlaceAddress(place);
    }
  };

  const handleSelectSuggestion = async (suggestion: AddressSuggestion) => {
    setResolvingPlaceId(suggestion.placeId);
    try {
      const place = await getPlaceDetails(
        suggestion.placeId,
        sessionTokenRef.current ?? undefined,
      );
      sessionTokenRef.current = null;
      if (!place) {
        alertModal.error(
          "Couldn't load that address",
          "Please pick another suggestion, or drag the map to your location.",
        );
        return;
      }
      applyPlaceAddress(place);
      setPin(place.geometry.location);
      setApproximate(!!place.approximate);
      pickerMapRef.current?.animateTo(place.geometry.location);
      // For a named place (a mall, a school), Google's address leaves the
      // name out — e.g. "SM City Marikina" resolves to just "Marikina, 1800
      // Metro Manila" — so keep the name as the landmark for the worker.
      const isNamedPlace = !place.formatted_address
        .toLowerCase()
        .includes(suggestion.mainText.toLowerCase());
      if (isNamedPlace) setLandmark((current) => current || suggestion.mainText);
      setSearchResults([]);
      setSearchQuery("");
      latestQueryRef.current = "";
    } catch (error) {
      console.error("Place details error:", error);
      alertModal.error(
        "Couldn't load that address",
        "Check your connection, then pick it again or drag the map to your location.",
      );
    } finally {
      setResolvingPlaceId(null);
    }
  };

  const handleSave = async () => {
    if (!pin) {
      alertModal.error(
        "Pin your address",
        "Search for your address, drag the map, or tap the GPS button so we know exactly where you are.",
      );
      return;
    }
    if (!isInPhilippines(pin)) {
      alertModal.error("Outside the Philippines", "HomeEase only serves addresses in the Philippines. Move the pin to your address.");
      return;
    }
    if (!fullAddress.trim()) {
      alertModal.error("Error", "Please enter your address.");
      return;
    }

    setSaving(true);
    try {
      // Bookings need a city. It almost always comes with the pin's address;
      // if not (e.g. the reverse lookup failed mid-drag), look it up once more.
      let parts = components;
      if (!parts.city) {
        const place = await reverseGeocodeDetailed(pin.lat, pin.lng).catch(
          () => null,
        );
        parts = { ...parts, ...(place?.components ?? {}) };
        if (!parts.city) {
          alertModal.error(
            "Couldn't identify the city",
            "We couldn't tell which city this pin is in. Try moving the pin slightly and saving again.",
          );
          return;
        }
        setComponents(parts);
      }

      const address = fullAddress.trim();
      const payload = {
        label,
        fullAddress: address,
        lat: pin.lat,
        lng: pin.lng,
        // Sent even when blank so an edit that moves the pin doesn't leave the
        // previous spot's street/barangay behind.
        houseNumber: parts.houseNumber ?? "",
        street: parts.street ?? "",
        barangay: parts.barangay ?? "",
        city: parts.city,
        state: parts.state ?? "",
        zipCode: parts.zipCode ?? "",
        landmark: landmark.trim(),
      };

      let savedId = addressId!;
      if (isNew) {
        savedId = (await api.addAddress(payload)).id;
      } else {
        await api.updateAddress(savedId, payload);
      }
      await addressStorage.upsert(savedId, {
        label,
        address,
        lat: pin.lat,
        lng: pin.lng,
      });

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

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title={isNew ? "Add Address" : "Edit Address"} showBack />
      <KeyboardAwareScrollView
        contentContainerStyle={{ padding: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Interactive Pin Map with Locate Me Button */}
        <View className="mb-4">
          <LocationPickerMap
            ref={pickerMapRef}
            initialLocation={pin}
            onLocationSelected={handleMapLocationSelected}
            onError={(msg, permissionDenied) =>
              alertModal.error(
                "Location error",
                msg,
                permissionDenied
                  ? [
                      { text: "Not now", style: "cancel" },
                      { text: "Open Settings", onPress: () => Linking.openSettings().catch(() => {}) },
                    ]
                  : undefined,
              )
            }
            height={260}
          />
          <Text className="text-text-muted text-xs text-center mt-2">
            Drag the map to pinpoint your exact gate or rooftop. Tap GPS to
            locate.
          </Text>
          {approximate && (
            <View className="flex-row items-center bg-warning/10 rounded-xl px-3 py-2 mt-2">
              <Ionicons
                name="information-circle"
                size={16}
                color={colors.warning}
              />
              <Text className="text-warning text-xs font-semibold ml-2 flex-1">
                This pin is only the general area — drag the map to your exact
                location.
              </Text>
            </View>
          )}
        </View>

        <InputField
          returnKeyType="search"
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
            {searchResults.map((suggestion) => (
              <Pressable
                key={suggestion.placeId}
                onPress={() => handleSelectSuggestion(suggestion)}
                disabled={resolvingPlaceId !== null}
                className="bg-white rounded-2xl p-3 mb-2 flex-row items-start"
                style={cardShadow}
                accessibilityRole="button"
                accessibilityLabel={suggestion.text}
              >
                {resolvingPlaceId === suggestion.placeId ? (
                  <ActivityIndicator
                    size="small"
                    color={colors.brand.DEFAULT}
                    style={{ marginTop: 2 }}
                  />
                ) : (
                  <Ionicons
                    name="location-outline"
                    size={18}
                    color={colors.text.muted}
                    style={{ marginTop: 2 }}
                  />
                )}
                <View className="ml-2 flex-1">
                  <Text className="text-text-primary text-sm font-semibold">
                    {suggestion.mainText}
                  </Text>
                  {!!suggestion.secondaryText && (
                    <Text className="text-text-secondary text-xs mt-0.5">
                      {suggestion.secondaryText}
                    </Text>
                  )}
                </View>
              </Pressable>
            ))}
          </View>
        )}

        <View className="bg-card rounded-2xl p-4 mb-4" style={cardShadow}>
          <Text className="text-text-primary text-sm mb-2 font-semibold">
            Label
          </Text>
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
          label="Full Address"
          value={fullAddress}
          onChangeText={(text) => {
            setFullAddress(text);
            setTextEdited(true);
          }}
          placeholder="e.g., Blk 4 Lot 12, Rizal St., Brgy. San Isidro, Paombong, Bulacan"
          multiline
        />

        {pinAddressOffer && (
          <Pressable
            onPress={() => applyPlaceAddress(pinAddressOffer)}
            className="flex-row items-start -mt-2 mb-4"
            accessibilityRole="button"
          >
            <Ionicons
              name="refresh"
              size={14}
              color={colors.accent.DEFAULT}
              style={{ marginTop: 2 }}
            />
            <Text className="text-accent text-xs ml-1 flex-1">
              Pin moved — use “{stripCountry(pinAddressOffer.formatted_address)}”
              instead?
            </Text>
          </Pressable>
        )}

        <InputField
          label="Landmark (optional)"
          value={landmark}
          onChangeText={setLandmark}
          placeholder="e.g., Beside Mercury Drug, green gate"
        />

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
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}
