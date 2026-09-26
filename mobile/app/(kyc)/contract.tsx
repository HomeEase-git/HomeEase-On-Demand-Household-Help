import React, { useRef, useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../components/ui/ScreenHeader";
import PrimaryButton from "../../components/ui/PrimaryButton";
import { colors } from "../../constants";
import { useAuthStore } from "../../store/authStore";
import { useAlertModal } from "../../contexts/AlertModalContext";
import { useToastContext } from "../../contexts/ToastContext";
import { acceptContract as acceptContractApi } from "../../services/api";
import { LegalSections } from "../../components/legal/LegalDocumentView";
import { CLIENT_TERMS, WORKER_AGREEMENT } from "../../constants/legalDocuments";

export default function ContractScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const toast = useToastContext();
  const user = useAuthStore((s) => s.user);
  const isWorker = user?.role === "worker";
  const scrollViewRef = useRef<ScrollView>(null);
  const [hasScrolled, setHasScrolled] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleScroll = ({ nativeEvent }: { nativeEvent: any }) => {
    const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
    const isNearBottom =
      layoutMeasurement.height + contentOffset.y >= contentSize.height - 40;
    if (isNearBottom) setHasScrolled(true);
  };

  const toggleAcceptance = () => {
    if (!hasScrolled) {
      alertModal.warning(
        "Please Read",
        "Please read the entire contract before accepting.",
      );
      return;
    }
    setAccepted(!accepted);
  };

  const contractDocument = isWorker ? WORKER_AGREEMENT : CLIENT_TERMS;

  const handleContinue = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await acceptContractApi(
        isWorker ? "WORKER_SERVICE_AGREEMENT" : "CLIENT_USER_AGREEMENT",
      );

      // This is what flips the worker's account into "awaiting admin
      // review" — without it the waiting screen's status would stay stale.
      if (isWorker) {
        useAuthStore.getState().setKycStatus("SUBMITTED");
      }

      router.push("/(kyc)/pending");
    } catch (error: any) {
      toast.error(
        error?.message || "Failed to submit. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader
        title={isWorker ? "Service Contract" : "User Agreement"}
        showBack
      />
      <View className="flex-1">
        <ScrollView
          ref={scrollViewRef}
          className="flex-1 mx-4 mt-4 bg-card rounded-2xl"
          contentContainerStyle={{ padding: 24 }}
          onScroll={handleScroll}
          scrollEventThrottle={16}
        >
          <LegalSections document={contractDocument} />
        </ScrollView>

        <View className="mx-4 mt-4 mb-2">
          <Pressable
            className="flex-row items-center mb-4"
            onPress={toggleAcceptance}
          >
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                marginRight: 12,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 2,
                borderColor:
                  accepted || hasScrolled
                    ? colors.accent.DEFAULT
                    : colors.divider,
                backgroundColor: accepted
                  ? colors.accent.DEFAULT
                  : "transparent",
              }}
            >
              {accepted && (
                <Text className="text-text-primary text-xs font-bold">✓</Text>
              )}
            </View>
            <Text className="text-text-secondary text-sm flex-1">
              I have read and agree to the{" "}
              {isWorker ? "Service Agreement" : "User Agreement"}
            </Text>
          </Pressable>

          <PrimaryButton
            label={isWorker ? "Submit for Review" : "Complete Registration"}
            fullWidth
            disabled={!accepted || submitting}
            loading={submitting}
            onPress={handleContinue}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}
