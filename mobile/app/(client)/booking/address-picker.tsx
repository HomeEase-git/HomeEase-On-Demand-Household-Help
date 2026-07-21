import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { WebView } from "react-native-webview";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import SearchBar from "../../../components/ui/SearchBar";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import { useBookingStore } from "../../../store/bookingStore";

type PlaceResult = {
  formatted_address: string;
  geometry: {
    location: { lat: number; lng: number };
  };
};

const DEFAULT_LOCATION = {
  lat: 14.5995,
  lng: 120.9842,
  address: "Manila, Philippines",
};

const getMapEmbedUrl = (address?: string, lat?: number, lng?: number) => {
  const query = address
    ? encodeURIComponent(address)
    : `${lat ?? DEFAULT_LOCATION.lat},${lng ?? DEFAULT_LOCATION.lng}`;

  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (apiKey) {
    return `https://www.google.com/maps/embed/v1/place?key=${apiKey}&q=${query}`;
  }

  return `https://www.google.com/maps?q=${query}&output=embed`;
};

const geocodeAddress = async (address: string): Promise<PlaceResult | null> => {
  const normalized = address.trim();
  if (!normalized) return null;

  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return {
      formatted_address: normalized,
      geometry: {
        location: { lat: DEFAULT_LOCATION.lat, lng: DEFAULT_LOCATION.lng },
      },
    };
  }

  const response = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      normalized,
    )}&key=${apiKey}`,
  );

  const data = await response.json();
  const firstResult = data?.results?.[0];
  if (!firstResult) return null;

  return firstResult as PlaceResult;
};

export default function AddressPickerScreen() {
  const router = useRouter();
  const draftAddress = useBookingStore((s) => s.draft.address);
  const setDraft = useBookingStore((s) => s.setDraft);

  const [searchQuery, setSearchQuery] = useState(draftAddress ?? "");
  const [selectedAddress, setSelectedAddress] = useState(
    draftAddress ?? DEFAULT_LOCATION.address,
  );
  const [selectedLocation, setSelectedLocation] = useState({
    lat: DEFAULT_LOCATION.lat,
    lng: DEFAULT_LOCATION.lng,
  });
  const [loading, setLoading] = useState(false);

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

  const handleSearch = () => {
    if (!searchQuery.trim()) {
      Alert.alert("Search required", "Please enter an address or landmark.");
      return;
    }
    void resolveAddress(searchQuery);
  };

  const handleConfirm = () => {
    setDraft({ address: selectedAddress });
    router.back();
  };

  const mapUrl = getMapEmbedUrl(
    selectedAddress,
    selectedLocation.lat,
    selectedLocation.lng,
  );

  return (
    <SafeAreaView className="flex-1 bg-primary-white" edges={["top"]}>
      <ScreenHeader title="Set Location" showBack />

      <View className="px-4 mt-2">
        <SearchBar
          placeholder="Search address..."
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        <Pressable
          className="self-start mt-2 flex-row items-center"
          onPress={handleSearch}
        >
          <Ionicons name="search-outline" size={16} color="#4B5FD6" />
          <Text className="ml-2 text-accent font-semibold">
            Search this address
          </Text>
        </Pressable>
      </View>

      <View className="flex-1 mx-4 mt-4 rounded-2xl overflow-hidden border border-card-light">
        {loading ? (
          <View className="flex-1 items-center justify-center bg-card">
            <ActivityIndicator size="large" color="#4B5FD6" />
            <Text className="text-text-secondary mt-3">Loading map...</Text>
          </View>
        ) : (
          <>
            <WebView
              source={{ uri: mapUrl }}
              style={{ flex: 1 }}
              originWhitelist={["*"]}
              javaScriptEnabled
              domStorageEnabled
              startInLoadingState
              renderLoading={() => (
                <View className="flex-1 items-center justify-center bg-card">
                  <ActivityIndicator size="large" color="#4B5FD6" />
                </View>
              )}
            />
            <View className="absolute self-center top-1/2 -mt-6">
              <Ionicons name="location" size={48} color="#EF4444" />
            </View>
          </>
        )}
      </View>

      <View className="bg-card p-4 mx-4 mt-4 rounded-2xl mb-4">
        <Text className="text-text-secondary text-xs">Selected Location</Text>
        <Text className="text-primary font-bold mt-1">{selectedAddress}</Text>
        <PrimaryButton
          label="Confirm This Location"
          fullWidth
          onPress={handleConfirm}
        />
      </View>
    </SafeAreaView>
  );
}
