import { useState } from "react";
import { isAxiosError } from "axios";
import * as api from "../services/api";
import { useAlertModal } from "../contexts/AlertModalContext";

const REPORT_REASONS = ["Spam", "Harassment", "Inappropriate content", "Scam or fraud", "Other"];

// Report-a-message and block/unblock for a chat screen (client and worker).
export function useChatSafety(userId: string | undefined, name: string | undefined) {
  const alertModal = useAlertModal();
  const [blockedByMe, setBlockedByMe] = useState(false);
  const who = name ?? "this user";

  const submitReport = async (messageId: string, reason: string) => {
    try {
      await api.reportMessage(messageId, reason);
      alertModal.success("Report sent", "Thanks. Our team will review this message.");
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 409) {
        alertModal.info("Already reported", "You've already reported this message.");
      } else {
        alertModal.error("Error", "Couldn't send your report. Please try again.");
      }
    }
  };

  const reportMessage = (messageId: string) =>
    alertModal.showAlert({
      variant: "warning",
      title: "Report message",
      message: "Why are you reporting this message?",
      buttons: [
        ...REPORT_REASONS.map((reason) => ({ text: reason, onPress: () => submitReport(messageId, reason) })),
        { text: "Cancel", style: "cancel" as const },
      ],
    });

  const setBlocked = async (block: boolean) => {
    if (!userId) return;
    try {
      await (block ? api.blockUser(userId) : api.unblockUser(userId));
      setBlockedByMe(block);
    } catch {
      alertModal.error("Error", `Couldn't ${block ? "block" : "unblock"} ${who}. Please try again.`);
    }
  };

  const openMenu = () =>
    blockedByMe
      ? alertModal.confirm(`Unblock ${who}?`, "You'll be able to message each other again.", {
          confirmText: "Unblock",
          onConfirm: () => setBlocked(false),
        })
      : alertModal.confirm(
          `Block ${who}?`,
          "Neither of you will be able to message the other, and you won't be matched again. Bookings already in progress carry on.",
          { confirmText: "Block", destructive: true, onConfirm: () => setBlocked(true) },
        );

  return { blockedByMe, setBlockedByMe, reportMessage, openMenu, unblock: () => setBlocked(false) };
}
