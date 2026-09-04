import React from "react";
import { Text, View } from "react-native";

export type StatusType =
  | "Pending"
  | "Accepted"
  | "Ongoing"
  | "InProgress"
  | "QuoteSubmitted"
  | "QuoteApproved"
  | "Disputed"
  | "PendingCompletion"
  | "AwaitingPayment"
  | "Completed"
  | "Cancelled"
  | "Credited"
  | "Verified"
  | "Declined"
  | "Pending KYC";

type Props = {
  status: StatusType;
};

export const StatusBadge: React.FC<Props> = ({ status }) => {
  let containerClass = "px-3 py-1 rounded-full";
  let textClass = "text-xs font-semibold";

  switch (status) {
    case "Pending":
    case "Pending KYC":
      containerClass += " bg-warning/20";
      textClass += " text-warning";
      break;
    case "Accepted":
      containerClass += " bg-blue-500/20";
      textClass += " text-blue-400";
      break;
    case "Declined":
      containerClass += " bg-error/20";
      textClass += " text-error";
      break;
    case "Ongoing":
    case "InProgress":
      containerClass += " bg-accent/20";
      textClass += " text-accent";
      break;
    case "QuoteSubmitted":
      containerClass += " bg-purple-500/20";
      textClass += " text-purple-400";
      break;
    case "QuoteApproved":
      containerClass += " bg-teal-500/20";
      textClass += " text-teal-400";
      break;
    case "Disputed":
      containerClass += " bg-orange-500/20";
      textClass += " text-orange-400";
      break;
    case "PendingCompletion":
      containerClass += " bg-teal-500/20";
      textClass += " text-teal-400";
      break;
    case "AwaitingPayment":
      containerClass += " bg-warning/20";
      textClass += " text-warning";
      break;
    case "Completed":
    case "Credited":
    case "Verified":
      containerClass += " bg-success/20";
      textClass += " text-success";
      break;
    case "Cancelled":
      containerClass += " bg-error/20";
      textClass += " text-error";
      break;
    default:
      containerClass += " bg-card-light";
      textClass += " text-text-primary";
  }

  const displayLabel: Record<string, string> = {
    InProgress: "In Progress",
    QuoteSubmitted: "Quote Submitted",
    QuoteApproved: "Quote Approved",
    PendingCompletion: "Awaiting Confirmation",
    AwaitingPayment: "Awaiting Payment",
    Pending: "Pending",
    Declined: "Declined",
    "Pending KYC": "Pending KYC",
  };

  return (
    <View className={containerClass}>
      <Text className={textClass}>{displayLabel[status] ?? status}</Text>
    </View>
  );
};

export default StatusBadge;
