import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../constants";

type Step = {
  label: string;
  timestamp?: string;
  status: "done" | "active" | "pending";
};

type Props = {
  steps: Step[];
};

export const StepperVertical: React.FC<Props> = ({ steps }) => {
  return (
    <View>
      {steps.map((step, index) => (
        <View key={index} className="flex-row">
          <View className="items-center mr-3">
            <View
              className={`w-6 h-6 rounded-full items-center justify-center ${
                step.status === "done"
                  ? "bg-success"
                  : step.status === "active"
                    ? "bg-accent"
                    : "bg-card-light"
              }`}
            >
              {step.status === "done" ? (
                <Ionicons name="checkmark" size={14} color={colors.white} />
              ) : (
                <View className="w-2 h-2 rounded-full bg-card" />
              )}
            </View>
            {index < steps.length - 1 && (
              <View className="w-px flex-1 min-h-[24px] bg-divider" />
            )}
          </View>
          <View className="flex-1 pb-4">
            <Text
              className={
                step.status === "pending"
                  ? "text-text-muted text-sm"
                  : "text-brand text-sm font-semibold"
              }
            >
              {step.label}
            </Text>
            {step.timestamp ? (
              <Text className="text-text-muted text-xs mt-0.5">
                {step.timestamp}
              </Text>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
};

export default StepperVertical;
