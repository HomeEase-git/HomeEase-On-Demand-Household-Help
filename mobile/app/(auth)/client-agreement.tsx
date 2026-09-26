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
import { CLIENT_TERMS } from "../../constants/legalDocuments";



export default function ClientAgreementScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const toast = useToastContext();
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
        "Please read the entire agreement before accepting.",
      );
      return;
    }
    setAccepted(!accepted);
  };

  const handleContinue = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await acceptContractApi("CLIENT_USER_AGREEMENT");
      useAuthStore.getState().setHasAcceptedTerms(true);
      router.replace("/(client)/home");
    } catch (error: any) {
      toast.error(error?.message || "Failed to submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="User Agreement" showBack={false} />
      <View className="flex-1">
        <ScrollView
          ref={scrollViewRef}
          className="flex-1 mx-4 mt-4 bg-card rounded-2xl"
          contentContainerStyle={{ padding: 24 }}
          onScroll={handleScroll}
          scrollEventThrottle={16}
        >
          <LegalSections document={CLIENT_TERMS} />
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
              I have read and agree to the User Agreement
            </Text>
          </Pressable>

          <PrimaryButton
            label="Continue"
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
