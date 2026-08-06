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

  const contractSections = isWorker
    ? [
        {
          heading: "SERVICE AGREEMENT — HomeEase Platform",
          body: 'This Service Agreement ("Agreement") is entered into between the Service Worker ("Worker") and HomeEase ("Platform"). By completing registration and using the platform, the Worker agrees to the following terms and conditions.',
        },
        {
          heading: "1. Worker Responsibilities",
          body: "The Worker agrees to: provide services professionally and punctually, maintain all required licenses and certifications, treat clients with respect and courtesy, complete agreed services to a satisfactory standard, and communicate promptly regarding any scheduling changes.",
        },
        {
          heading: "2. Platform Commission",
          body: "The Platform retains a service fee of 10% from each completed transaction. The Worker receives 90% of the agreed service price. Payments are processed within 24-48 hours of job completion.",
        },
        {
          heading: "3. Prohibited Conduct",
          body: "Workers must not: solicit clients outside the platform, misrepresent qualifications or experience, engage in discriminatory behavior, share client personal information, or provide services under the influence of substances.",
        },
        {
          heading: "4. Document Transparency",
          body: "Workers consent to having their submitted documents, certifications, and resume visible on their public profile. Clients use this information to make informed booking decisions. HomeEase does not independently verify the authenticity of submitted documents.",
        },
        {
          heading: "5. Termination",
          body: "Either party may terminate this agreement with 7 days written notice. HomeEase reserves the right to immediately suspend accounts involved in fraudulent, harmful, or policy-violating activity.",
        },
        {
          heading: "6. Dispute Resolution",
          body: "In the event of a dispute between Worker and Client, either party may raise it through the in-app dispute flow on the affected booking. HomeEase will review the evidence — chat history, booking records, quote submissions, and submitted documentation — and issue a resolution (which may include approving a quote, requesting a revised quote, or cancelling the booking with a refund). If the Worker believes a resolution was made in error, they may contact HomeEase Support to request it be reconsidered. This process does not limit either party's right to pursue other legal remedies.",
        },
        {
          heading: "7. Governing Law",
          body: "This Agreement is governed by the laws of the Republic of the Philippines. Any legal disputes shall be resolved in the appropriate courts of Bulacan province.",
        },
      ]
    : [
        {
          heading: "USER AGREEMENT — HomeEase Platform",
          body: 'This User Agreement ("Agreement") is entered into between you ("Client") and HomeEase ("Platform"). By completing registration and using the platform, you agree to the following terms and conditions.',
        },
        {
          heading: "1. Client Responsibilities",
          body: "As a client, you agree to: provide accurate information when posting service requests, communicate respectfully with service providers, honor confirmed bookings, and pay for services in full and on time according to the agreed terms.",
        },
        {
          heading: "2. Service Booking",
          body: "You may browse, request, and book services from verified workers on HomeEase. All bookings are subject to worker availability and acceptance. HomeEase acts as a platform and is not responsible for service quality or worker conduct.",
        },
        {
          heading: "3. Payment & Refunds",
          body: "Payments are collected through HomeEase's secure payment system. Refunds are available if you cancel within 24 hours of a scheduled booking. Disputes regarding service quality will be mediated by HomeEase support team.",
        },
        {
          heading: "4. User Conduct",
          body: "You must not: harass or discriminate against service workers, share false reviews, attempt to contact workers outside the platform, or engage in fraudulent activity. Violations may result in account suspension.",
        },
        {
          heading: "5. Privacy & Data",
          body: "Your personal information, including address and payment details, will be shared with confirmed service workers only as necessary to complete bookings. HomeEase protects your data according to our Privacy Policy.",
        },
        {
          heading: "6. Termination",
          body: "HomeEase reserves the right to suspend or terminate accounts involved in fraudulent, abusive, or policy-violating activity. You may delete your account at any time through your profile settings.",
        },
        {
          heading: "7. Governing Law",
          body: "This Agreement is governed by the laws of the Republic of the Philippines. Any legal disputes shall be resolved in the appropriate courts of Bulacan province.",
        },
      ];

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
          {contractSections.map((section, index) => (
            <View key={index}>
              <Text className="text-text-primary font-bold text-base mb-2">
                {section.heading}
              </Text>
              <Text className="text-text-secondary text-sm mb-4">
                {section.body}
              </Text>
            </View>
          ))}
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
