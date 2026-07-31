import React, { useEffect, useState } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import LeafletMap from "./LeafletMap";
import { geocodeAddress, type LatLng } from "../../utils/geo";
import { colors } from "../../constants";

type Props = {
  address?: string | null;
  height?: string;
  zoom?: number;
};

type Status = "loading" | "found" | "missing" | "error";

export const AddressMap: React.FC<Props> = ({
  address,
  height = "h-48",
  zoom,
}) => {
  const [coords, setCoords] = useState<LatLng | null>(null);
  const [status, setStatus] = useState<Status>(address ? "loading" : "missing");

  useEffect(() => {
    let active = true;
    if (!address) {
      setStatus("missing");
      setCoords(null);
      return;
    }
    setStatus("loading");
    setCoords(null);
    geocodeAddress(address)
      .then((result) => {
        if (!active) return;
        if (result) {
          setCoords(result.geometry.location);
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
  }, [address]);

  if (status === "found" && coords) {
    return (
      <View className={`w-full rounded-2xl overflow-hidden ${height}`}>
        <LeafletMap destination={coords} destinationLabel={address ?? undefined} zoom={zoom} />
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
