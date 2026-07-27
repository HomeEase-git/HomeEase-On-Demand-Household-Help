import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import SearchBar from "../../../components/ui/SearchBar";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import LeafletMap from "../../../components/ui/LeafletMap";
import { useBookingStore } from "../../../store/bookingStore";
import { colors } from "../../../constants";
import { addressStorage } from "../../../utils/storage";
import {
  geocodeAddress,
  reverseGeocode,
  fetchRoute,
  type LatLng,
  type RouteResult,
} from "../../../utils/geo";
import {
  getCurrentPosition,
  LocationPermissionDeniedError,
} from "../../../services/location";

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
  const draftAddress = useBookingStore((s) => s.draft.address);
  const setDraft = useBookingStore((s) => s.setDraft);

  const [searchQuery, setSearchQuery] = useState(draftAddress ?? "");
  const [selectedAddress, setSelectedAddress] = useState(
    draftAddress ?? DEFAULT_LOCATION.address,
  );
  const [selectedLocation, setSelectedLocation] = useState<LatLng>({
    lat: DEFAULT_LOCATION.lat,
    lng: DEFAULT_LOCATION.lng,
  });
  const [loading, setLoading] = useState(false);

  const [currentLocation, setCurrentLocation] = useState<LatLng | null>(null);
  const [locatingMe, setLocatingMe] = useState(false);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);

  const resolveAddress = useCallback(async (address: string) => {
    setLoading(true);
    try {
      const result = await geocodeAddress(address);
      if (result) {
        setSelectedAddress(result.formatted_address || address);
        setSelectedLocation(result.geometry.location);
        setSearchQuery(result.formatted_address || address);
      } else {
        setSelectedAddress(address);
        setSelectedLocation({
          lat: DEFAULT_LOCATION.lat,
          lng: DEFAULT_LOCATION.lng,
        });
      }
    } catch (error) {
      console.error("Geocoding failed", error);
      Alert.alert(
        "Location unavailable",
        "Unable to resolve this address right now.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (draftAddress) {
      void resolveAddress(draftAddress);
    }
  }, [draftAddress, resolveAddress]);

  // Best-effort: silently pick up the device location if permission is
  // already granted, so a route can be drawn without the user having to ask.
  useEffect(() => {
    getCurrentPosition()
      .then(setCurrentLocation)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const loadSaved = async () => {
      const stored = await addressStorage.list();
      const withCoords = (stored as any[]).filter(
        (item) => typeof item.lat === "number" && typeof item.lng === "number",
      );
      setSavedAddresses(withCoords as SavedAddress[]);
    };
    loadSaved();
  }, []);

  useEffect(() => {
    let active = true;

    if (!currentLocation) {
      setRoute(null);
      return;
    }

    setRouteLoading(true);
    fetchRoute(currentLocation, selectedLocation)
      .then((result) => {
        if (!active) return;
        setRoute(result);
      })
      .catch(() => {
        if (!active) return;
        setRoute(null);
      })
      .finally(() => {
        if (!active) return;
        setRouteLoading(false);
      });

    return () => {
      active = false;
    };
  }, [currentLocation, selectedLocation]);

  const handleSearch = () => {
    if (!searchQuery.trim()) {
      Alert.alert("Search required", "Please enter an address or landmark.");
      return;
    }
    void resolveAddress(searchQuery);
  };

  const handleUseCurrentLocation = async () => {
    setLocatingMe(true);
    try {
      const position = await getCurrentPosition();
      setCurrentLocation(position);
      setSelectedLocation(position);
      const address = await reverseGeocode(position.lat, position.lng);
      const resolved = address ?? "Current location";
      setSelectedAddress(resolved);
      setSearchQuery(resolved);
    } catch (error) {
      if (error instanceof LocationPermissionDeniedError) {
        Alert.alert(
          "Location permission needed",
          "Enable location access to use your current location.",
        );
      } else {
        Alert.alert("Location unavailable", "Unable to get your current location right now.");
      }
    } finally {
      setLocatingMe(false);
    }
  };

  const handleSelectSaved = (item: SavedAddress) => {
    setSelectedAddress(item.address);
    setSelectedLocation({ lat: item.lat, lng: item.lng });
    setSearchQuery(item.address);
  };

  const handleConfirm = () => {
    setDraft({
      address: selectedAddress,
      lat: selectedLocation.lat,
      lng: selectedLocation.lng,
    });
    router.back();
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top"]}>
      <ScreenHeader title="Set Location" showBack />

      <View className="px-4 mt-2">
        <SearchBar
          placeholder="Search address..."
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        <View className="flex-row items-center justify-between mt-2">
          <Pressable
            className="flex-row items-center"
            onPress={handleSearch}
          >
            <Ionicons name="search-outline" size={16} color={colors.brand.DEFAULT} />
            <Text className="ml-2 text-accent font-semibold">
              Search this address
            </Text>
          </Pressable>

          <Pressable
            className="flex-row items-center"
            onPress={handleUseCurrentLocation}
            disabled={locatingMe}
          >
            {locatingMe ? (
              <ActivityIndicator size="small" color={colors.accent.DEFAULT} />
            ) : (
              <Ionicons name="locate" size={16} color={colors.accent.DEFAULT} />
            )}
            <Text className="ml-2 text-accent font-semibold">
              Use current location
            </Text>
          </Pressable>
        </View>
      </View>

      {savedAddresses.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-3"
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
        >
          {savedAddresses.map((item) => (
            <Pressable
              key={item.id}
              className="bg-card-light rounded-full px-4 py-2 flex-row items-center"
              onPress={() => handleSelectSaved(item)}
            >
              <Ionicons name="bookmark-outline" size={14} color={colors.brand.DEFAULT} />
              <Text className="ml-2 text-brand text-sm">{item.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <View className="flex-1 mx-4 mt-4 rounded-2xl overflow-hidden border border-card-light">
        {loading ? (
          <View className="flex-1 items-center justify-center bg-card">
            <ActivityIndicator size="large" color={colors.brand.DEFAULT} />
            <Text className="text-text-secondary mt-3">Loading map...</Text>
          </View>
        ) : (
          <LeafletMap
            destination={selectedLocation}
            destinationLabel={selectedAddress}
            currentLocation={currentLocation}
            routeCoordinates={route?.coordinates}
          />
        )}
      </View>

      <View className="bg-card p-4 mx-4 mt-4 rounded-2xl mb-4">
        <Text className="text-text-secondary text-xs">Selected Location</Text>
        <Text className="text-text-primary font-bold mt-1">{selectedAddress}</Text>

        {routeLoading ? (
          <Text className="text-text-muted text-xs mt-1">Calculating route...</Text>
        ) : route ? (
          <Text className="text-text-muted text-xs mt-1">
            {route.distanceKm.toFixed(1)} km · {Math.round(route.durationMin)} min drive
          </Text>
        ) : null}

        <PrimaryButton
          label="Confirm This Location"
          fullWidth
          onPress={handleConfirm}
        />
      </View>
    </SafeAreaView>
  );
}
