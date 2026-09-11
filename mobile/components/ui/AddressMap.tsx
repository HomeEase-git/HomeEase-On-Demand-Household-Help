import React, { useEffect, useState } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import LeafletMap from "./LeafletMap";
import { geocodeAddress, type LatLng } from "../../utils/geo";
import { colors } from "../../constants";

type Props = {
  address?: string | null;
  // Pass this whenever the caller already has resolved coordinates (e.g. a
  // booking's persisted clientLat/clientLng) — skips geocoding entirely
  // instead of re-resolving the same address from text on every render/view.
  coords?: LatLng | null;
  height?: string;
  zoom?: number;
};

type Status = "loading" | "found" | "missing" | "error";

const initialStatus = (address?: string | null, coords?: LatLng | null): Status =>
  coords ? "found" : address ? "loading" : "missing";

export const AddressMap: React.FC<Props> = ({
  address,
  coords,
  height = "h-48",
  zoom,
}) => {
  const [geocodedCoords, setGeocodedCoords] = useState<LatLng | null>(null);
  const [status, setStatus] = useState<Status>(() => initialStatus(address, coords));
  // Re-derive state when either input changes, same pattern as the address
  // string alone used to use — comparing a combined key during render avoids
  // a flash of stale content before an effect would otherwise catch up.
  const [prevKey, setPrevKey] = useState(`${coords?.lat ?? ""},${coords?.lng ?? ""}|${address ?? ""}`);
  const key = `${coords?.lat ?? ""},${coords?.lng ?? ""}|${address ?? ""}`;

  if (key !== prevKey) {
    setPrevKey(key);
    setStatus(initialStatus(address, coords));
    setGeocodedCoords(null);
  }

  useEffect(() => {
    if (coords) return; // already precise — nothing to geocode
    if (!address) return;
    let active = true;
    geocodeAddress(address)
      .then((result) => {
        if (!active) return;
        if (result) {
          setGeocodedCoords(result.geometry.location);
          setStatus("found");
        } else {
          setStatus("error");
        }
      })
      .catch(() => {
        if (active) setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [address, coords]);

  const resolvedCoords = coords ?? geocodedCoords;

  if (status === "found" && resolvedCoords) {
    return (
      <View className={`w-full rounded-2xl overflow-hidden ${height}`}>
        <LeafletMap destination={resolvedCoords} destinationLabel={address ?? undefined} zoom={zoom} />
      </View>
    );
  }

  return (
    <View
      className={`w-full bg-card-dark rounded-2xl items-center justify-center px-4 ${height}`}
    >
      {status === "loading" ? (
        <ActivityIndicator color={colors.accent.DEFAULT} />
      ) : (
        <Ionicons name="map-outline" size={40} color={colors.accent.DEFAULT} />
      )}
      <Text className="text-brand mt-2">
        {status === "loading"
          ? "Loading map..."
          : status === "missing"
            ? "No address provided"
            : "Location not found on map"}
      </Text>
      {address ? (
        <Text
          className="text-text-primary text-xs font-semibold mt-2 text-center"
          numberOfLines={2}
        >
          {address}
        </Text>
      ) : null}
    </View>
  );
};

export default AddressMap;
