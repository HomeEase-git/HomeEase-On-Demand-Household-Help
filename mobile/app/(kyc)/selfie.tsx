import React, { useRef, useState, useEffect } from "react";
import { View, Text, ScrollView, Pressable, Alert, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import ScreenHeader from "../../components/ui/ScreenHeader";
import StepperHorizontal from "../../components/steppers/StepperHorizontal";
import PrimaryButton from "../../components/ui/PrimaryButton";
import OutlinedButton from "../../components/ui/OutlinedButton";
import { useAuthStore } from "../../store/authStore";
import { submitKycDocument } from "../../services/api";
import { compressImage } from "../../utils/imageCompressor";
import { colors } from "../../constants/colors";

export default function SelfieScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraActive, setCameraActive] = useState(false);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const isWorker = user?.role === "worker";

  // Clients only need ID + selfie; workers continue on to
  // clearances/certifications, resume, then the contract.
  const stepperSteps = isWorker
    ? ["ID", "Selfie", "Certifications", "Resume", "Contract"]
    : ["ID", "Selfie", "Contract"];

  useEffect(() => {
    if (!permission) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  const handleTakeSelfie = async () => {
    if (!permission?.granted) {
      Alert.alert(
        "Camera Permission",
        "Camera access is required to take a selfie.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Grant Permission", onPress: requestPermission },
        ],
      );
      return;
    }
    setCameraActive(true);
  };

  const handleCapture = async () => {
    if (!cameraRef.current) return;
    setCompressing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        base64: false,
        skipProcessing: false,
      });
      if (photo?.uri) {
        // Automatically compress the captured selfie
        let selfieUri = photo.uri;
        try {
          const compressed = await compressImage(photo.uri, 1200, 0.7);
          selfieUri = compressed.uri;
          setCapturedUri(compressed.uri);
          Alert.alert(
            "Selfie Captured",
            `Compressed by ${compressed.compressionRatio}%`,
            [{ text: "OK" }],
            { cancelable: false },
          );
        } catch (err) {
          // If compression fails, use original
          setCapturedUri(photo.uri);
          console.error("Compression failed, using original:", err);
        }

        try {
          setSubmitting(true);
          await submitKycDocument("selfie", selfieUri);
        } catch (error) {
          console.error("KYC selfie submit error", error);
          Alert.alert(
            "Submission failed",
            "We could not upload your selfie. Please try again.",
          );
        } finally {
          setSubmitting(false);
          setCameraActive(false);
        }
      }
    } catch (err) {
      Alert.alert("Error", "Failed to capture photo. Please try again.");
      console.error("Capture error:", err);
    } finally {
      setCompressing(false);
    }
  };

  const handleContinue = () => {
    if (isWorker) {
      router.push("/(kyc)/documents");
    } else {
      router.push("/(kyc)/contract");
    }
  };

  const handleRetake = () => {
    setCapturedUri(null);
    setCameraActive(false);
  };

  // Active camera view
  if (cameraActive && permission?.granted) {
    return (
      <SafeAreaView className="flex-1 bg-black">
        <CameraView ref={cameraRef} facing="front" style={{ flex: 1 }} />

        {/* Oval face guide overlay */}
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <View
            style={{
              width: 192,
              height: 224,
              borderRadius: 999,
              borderWidth: 3,
              borderColor: "rgba(255,255,255,0.5)",
            }}
          />
          <Text style={{ color: "white", fontSize: 13, marginTop: 16 }}>
            Position your face within the oval
          </Text>
        </View>

        {/* Camera controls */}
        <View
          style={{
            position: "absolute",
            bottom: 32,
            left: 0,
            right: 0,
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            paddingHorizontal: 32,
          }}
        >
          <Pressable
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: "rgba(0,0,0,0.4)",
              alignItems: "center",
              justifyContent: "center",
            }}
            onPress={() => setCameraActive(false)}
          >
            <Ionicons name="close" size={24} color="white" />
          </Pressable>

          <Pressable
            style={{
              width: 80,
              height: 80,
              borderRadius: 40,
              borderWidth: 4,
              borderColor: "white",
              alignItems: "center",
              justifyContent: "center",
            }}
            onPress={handleCapture}
          >
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                backgroundColor: "white",
              }}
            />
          </Pressable>

          <View style={{ width: 48 }} />
        </View>
      </SafeAreaView>
    );
  }

  // Preview / selection view
  return (
    <SafeAreaView className="flex-1 bg-primary-white">
      <ScreenHeader title="Take a Selfie" showBack />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }}
      >
        <StepperHorizontal steps={stepperSteps} currentStep={1} />

        {capturedUri ? (
          // Show the actual captured photo
          <View
            style={{
              width: "100%",
              height: 288,
              borderRadius: 16,
              overflow: "hidden",
              marginBottom: 16,
            }}
          >
            <Image
              source={{ uri: capturedUri }}
              style={{ width: "100%", height: "100%" }}
              resizeMode="cover"
            />
            <View
              style={{
                position: "absolute",
                top: 8,
                left: 8,
                backgroundColor: "rgba(0,0,0,0.5)",
                borderRadius: 8,
                paddingHorizontal: 8,
                paddingVertical: 4,
              }}
            >
              <Text
                style={{ color: "#4CAF50", fontSize: 12, fontWeight: "600" }}
              >
                ✓ Selfie captured
              </Text>
            </View>
          </View>
        ) : (
          // Placeholder before capture
          <View className="w-full h-72 bg-card-dark rounded-2xl items-center justify-center mb-4">
            <View
              style={{
                width: 192,
                height: 224,
                borderRadius: 999,
                borderWidth: 4,
                borderColor: "white",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="person" size={80} color={colors.text.muted} />
            </View>
            <Text className="text-text-secondary mt-2">
              Position your face within the oval
            </Text>
          </View>
        )}

        {/* Tips */}
        <View className="flex-row flex-wrap gap-2 mb-6">
          {[
            "Good lighting",
            "Face forward",
            "No glasses",
            "Plain background",
          ].map((tip) => (
            <View key={tip} className="bg-card-light rounded-full px-3 py-2">
              <Text className="text-text-secondary text-xs">{tip}</Text>
            </View>
          ))}
        </View>

        {!capturedUri ? (
          <PrimaryButton
            label="Open Camera"
            fullWidth
            onPress={handleTakeSelfie}
          />
        ) : (
          <View className="gap-3">
            <PrimaryButton
              label="Continue"
              fullWidth
              disabled={submitting}
              onPress={handleContinue}
            />
            <OutlinedButton label="Retake Photo" onPress={handleRetake} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
