import React from "react";
import { Modal, View, Pressable, ActivityIndicator } from "react-native";
import { WebView, WebViewNavigation } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../constants";

// Must match XENDIT_REDIRECT_BASE_URL in the backend's .env plus the paths
// paymentController.ts's createXenditCheckout appends. Xendit requires a
// real http(s) URL for Invoice redirects (custom app schemes are rejected as
// invalid format), so this placeholder domain never needs to actually
// resolve — we intercept navigation to it below and cancel the load before
// the WebView ever tries to reach it.
const REDIRECT_SUCCESS_PREFIX = "https://homeease.app/payment-redirect/success";
const REDIRECT_FAILED_PREFIX = "https://homeease.app/payment-redirect/failed";

type Props = {
  visible: boolean;
  checkoutUrl: string | null;
  onSuccess: () => void;
  onFailed: () => void;
  onCancel: () => void;
};

export default function XenditCheckoutModal({
  visible,
  checkoutUrl,
  onSuccess,
  onFailed,
  onCancel,
}: Props) {
  const handleShouldStartLoad = (request: WebViewNavigation) => {
    if (request.url.startsWith(REDIRECT_SUCCESS_PREFIX)) {
      onSuccess();
      return false;
    }
    if (request.url.startsWith(REDIRECT_FAILED_PREFIX)) {
      onFailed();
      return false;
    }
    return true;
  };

  if (!checkoutUrl) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onCancel}
      presentationStyle="pageSheet"
    >
      <View style={{ flex: 1, backgroundColor: colors.white }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "flex-end",
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderBottomWidth: 1,
            borderBottomColor: colors.divider,
          }}
        >
          <Pressable onPress={onCancel} hitSlop={10}>
            <Ionicons name="close" size={24} color={colors.text.primary} />
          </Pressable>
        </View>
        <WebView
          source={{ uri: checkoutUrl }}
          onShouldStartLoadWithRequest={handleShouldStartLoad}
          startInLoadingState
          renderLoading={() => (
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ActivityIndicator size="large" color={colors.accent.DEFAULT} />
            </View>
          )}
        />
      </View>
    </Modal>
  );
}
