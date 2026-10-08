import React, { useState } from "react";
import { Modal, View, Text, Pressable, ActivityIndicator } from "react-native";
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
  // Offline or a dead page leaves a blank sheet; show a retry instead.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // A new checkout (reopened, or another booking's URL) starts clean.
  const [shownFor, setShownFor] = useState({ visible, checkoutUrl });
  if (shownFor.visible !== visible || shownFor.checkoutUrl !== checkoutUrl) {
    setShownFor({ visible, checkoutUrl });
    setFailed(false);
  }

  const handleShouldStartLoad = (request: WebViewNavigation) => {
    if (request.url.startsWith(REDIRECT_SUCCESS_PREFIX)) {
      onSuccess();
      return false;
    }
    if (request.url.startsWith(REDIRECT_FAILED_PREFIX)) {
      onFailed();
      return false;
    }
    // Payment pages only ever need secure web pages. Refuse anything else a
    // compromised or spoofed page might send the WebView to — plain http://,
    // file://, javascript:, data:, content:// or intent:// links.
    return request.url.startsWith("https://") || request.url === "about:blank";
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
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onCancel} hitSlop={10}>
            <Ionicons name="close" size={24} color={colors.text.primary} />
          </Pressable>
        </View>
        {failed ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
            <Ionicons name="cloud-offline-outline" size={40} color={colors.text.muted} />
            <Text style={{ color: colors.text.primary, fontWeight: "600", marginTop: 12, textAlign: "center" }}>
              Couldn&apos;t open the payment page
            </Text>
            <Text style={{ color: colors.text.secondary, marginTop: 4, textAlign: "center" }}>
              Check your connection and try again.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setFailed(false);
                setAttempt((n) => n + 1);
              }}
              style={{ marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.accent.DEFAULT }}
            >
              <Text style={{ color: colors.white, fontWeight: "600" }}>Try again</Text>
            </Pressable>
          </View>
        ) : (
        <WebView
          key={attempt}
          source={{ uri: checkoutUrl }}
          onError={() => setFailed(true)}
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
        )}
      </View>
    </Modal>
  );
}
