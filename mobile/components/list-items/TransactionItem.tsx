import React from "react";
import { View, Text, Pressable } from "react-native";
import StatusBadge from "../ui/StatusBadge";
import type { StatusType } from "../ui/StatusBadge";

type Transaction = {
  id: string;
  bookingId: string;
  amount: number;
  method: string;
  status: string;
  date: string;
};

type Props = {
  transaction: Transaction;
  onPress: () => void;
};

export const TransactionItem: React.FC<Props> = ({ transaction, onPress }) => {
  return (
    <Pressable
      className="flex-row items-center py-4 border-b border-divider"
      onPress={onPress}
    >
      <View className="flex-1">
        <Text className="text-text-muted text-xs">
          {transaction.id} · {transaction.date}
        </Text>
        <Text className="text-text-primary font-semibold mt-0.5">
          Booking {transaction.bookingId}
        </Text>
      </View>
      <Text className="text-success font-bold mr-2">
        +₱{transaction.amount}
      </Text>
      <StatusBadge status={transaction.status as StatusType} />
    </Pressable>
  );
};

export default TransactionItem;
