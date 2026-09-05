import React, { useEffect, useState, useRef } from "react";
import { View, ScrollView, TextInput, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import InputField from "../../../components/ui/InputField";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import { useAuthStore } from "../../../store/authStore";
import * as api from "../../../services/api";
import { cardShadow } from "../../../constants";
import { useAlertModal } from "../../../contexts/AlertModalContext";
import { geocodeAddress } from "../../../utils/geo";

export default function WorkerEditProfileScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [email] = useState(user?.email ?? "");
  const [bio, setBio] = useState("");
  const [areaRadius, setAreaRadius] = useState("");
  const [trade, setTrade] = useState("");
  const [serviceArea, setServiceArea] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");

  // Service address — geocoded on save so the backend can compute the
  // distance-based pricing fee between this fixed address and a client's
  // booking location (bookings are scheduled in advance, not dispatched to
  // wherever the worker currently is).
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [addressState, setAddressState] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [addressCoords, setAddressCoords] = useState<{ lat: number; lng: number } | null>(null);
  // True once the address/city/state/zip text has been edited since the
  // last resolved coordinate pair — distinguishes "never touched this
  // session" (fine to leave addressLat/Lng untouched on save) from
  // "changed but re-geocode never resolved" (must clear the now-stale
  // addressLat/Lng rather than silently keep pricing pinned to the old spot).
  const [addressDirty, setAddressDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadWorkerProfile() {
      try {
        const detail = await api.getMyWorkerProfileDetails();
        if (!active || !detail) return;
        setBio(detail.bio ?? "");
        setAreaRadius(detail.serviceAreaRadius ? String(detail.serviceAreaRadius) : "");
        setAddress(detail.address ?? "");
        setCity(detail.city ?? "");
        setAddressState(detail.state ?? "");
        setZipCode(detail.zipCode ?? "");
        if (detail.addressLat != null && detail.addressLng != null) {
          setAddressCoords({ lat: detail.addressLat, lng: detail.addressLng });
        }
      } catch (error) {
        console.error("Load worker profile for edit error:", error);
      }
    }
    async function loadDigitalId() {
      try {
        const digitalId = await api.getMyDigitalId();
        if (!active) return;
        setTrade(digitalId.trade ?? "");
        setServiceArea(digitalId.serviceArea ?? "");
        setLicenseNumber(digitalId.licenseNumber ?? "");
      } catch (error) {
        console.error("Load digital ID for edit error:", error);
      }
    }
    loadWorkerProfile();
    loadDigitalId();
    return () => {
      active = false;
    };
  }, [user?.id]);

  const nameRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const bioRef = useRef<TextInput>(null);
  const areaRef = useRef<TextInput>(null);

  // Re-geocode whenever the address text changes so a stale coordinate pair
  // never gets sent alongside edited text.
  const addressChanged = (updater: () => void) => {
    updater();
    setAddressCoords(null);
    setAddressDirty(true);
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      alertModal.error("Error", "Name cannot be empty.");
      return;
    }
    if (!phone.trim()) {
      alertModal.error("Error", "Phone number cannot be empty.");
      return;
    }

    setSubmitting(true);
    try {
      const updatedUser = await api.updateUserProfile({
        fullName: name.trim(),
        phone: phone.trim(),
      });

      const trimmedAddress = address.trim();
      const trimmedCity = city.trim();
      let coords = addressCoords;

      if (trimmedAddress && trimmedCity && !coords) {
        const fullAddress = [trimmedAddress, trimmedCity, addressState.trim(), zipCode.trim()]
          .filter(Boolean)
          .join(", ");
        try {
          const geocoded = await geocodeAddress(fullAddress);
          if (geocoded) {
            coords = geocoded.geometry.location;
            setAddressCoords(coords);
            setAddressDirty(false);
          }
        } catch (error) {
          console.error("Geocode worker address error:", error);
        }
        if (!coords) {
          alertModal.info(
            "Address saved, pricing not updated",
            "We couldn't verify that address, so distance-based pricing won't use it yet. Everything else was saved."
          );
        }
      }

      // addressDirty means the text changed since the last resolved coords
      // (or was cleared) and re-geocoding above didn't produce a fresh pair.
      // Sending `undefined` here would leave the *previous* address's
      // addressLat/addressLng in place, so future bookings would silently
      // keep computing the distance fee against the old location instead of
      // the one just saved. Send an explicit null instead so the backend
      // clears it (treated the same as "no address on file yet" — no
      // distance fee — rather than a wrong one).
      const addressLat = coords ? coords.lat : addressDirty ? null : undefined;
      const addressLng = coords ? coords.lng : addressDirty ? null : undefined;

      await api.updateWorkerProfileDetails({
        bio: bio.trim(),
        serviceAreaRadius: parseInt(areaRadius, 10) || undefined,
        address: trimmedAddress,
        city: trimmedCity,
        state: addressState.trim(),
        zipCode: zipCode.trim(),
        addressLat,
        addressLng,
        digitalIdTrade: trade.trim(),
        digitalIdServiceArea: serviceArea.trim(),
        licenseNumber: licenseNumber.trim(),
      });

      setUser(updatedUser);

      alertModal.success("Success", "Profile updated successfully.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (error) {
      console.error("Update profile error:", error);
      alertModal.error("Error", "Failed to update profile.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Edit Profile" showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <InputField
          ref={nameRef}
          label="Full Name"
          value={name}
          onChangeText={setName}
          returnKeyType="next"
          onSubmitEditing={() => phoneRef.current?.focus()}
        />
        <InputField
          ref={phoneRef}
          label="Phone"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          returnKeyType="next"
          onSubmitEditing={() => bioRef.current?.focus()}
        />
        <InputField
          label="Email"
          value={email}
          onChangeText={() => {}}
          editable={false}
        />
        <InputField
          ref={bioRef}
          label="Bio"
          value={bio}
          onChangeText={setBio}
          multiline
          returnKeyType="next"
          onSubmitEditing={() => areaRef.current?.focus()}
        />
        <InputField
          ref={areaRef}
          label="Service Area Radius (km)"
          value={areaRadius}
          onChangeText={setAreaRadius}
          keyboardType="number-pad"
          returnKeyType="done"
        />

        <View className="bg-card-light rounded-2xl p-4 mb-5" style={cardShadow}>
          <Text className="text-text-primary font-semibold">Service address</Text>
          <Text className="text-text-secondary text-sm mt-1 mb-3">
            Where you&apos;re based — used to calculate the distance fee on
            bookings scheduled near you, not to track your live location.
          </Text>

          <InputField
            label="Street address"
            value={address}
            onChangeText={(v) => addressChanged(() => setAddress(v))}
            placeholder="123 Rizal St."
          />
          <InputField
            label="City"
            value={city}
            onChangeText={(v) => addressChanged(() => setCity(v))}
            placeholder="Quezon City"
          />
          <InputField
            label="Province / State"
            value={addressState}
            onChangeText={(v) => addressChanged(() => setAddressState(v))}
            placeholder="Metro Manila"
          />
          <InputField
            label="ZIP Code"
            value={zipCode}
            onChangeText={(v) => addressChanged(() => setZipCode(v))}
            keyboardType="number-pad"
            placeholder="1100"
          />
          {addressCoords && (
            <Text className="text-success text-xs mt-1">Address verified for pricing.</Text>
          )}
        </View>

        <View className="bg-card-light rounded-2xl p-4 mb-5" style={cardShadow}>
          <Text className="text-text-primary font-semibold">Digital ID details</Text>
          <Text className="text-text-secondary text-sm mt-1 mb-3">
            Shown on your Digital ID card alongside your verified photo and
            name.
          </Text>

          <InputField
            label="Trade / Profession"
            value={trade}
            onChangeText={setTrade}
            placeholder="Plumbing"
          />
          <InputField
            label="Service Area"
            value={serviceArea}
            onChangeText={setServiceArea}
            placeholder="Quezon City"
          />
          <InputField
            label="License / Registration Number"
            value={licenseNumber}
            onChangeText={setLicenseNumber}
            placeholder="ABC-2024-001"
          />
        </View>

        <PrimaryButton
          label="Save Changes"
          fullWidth
          onPress={handleSubmit}
          disabled={submitting}
          loading={submitting}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
