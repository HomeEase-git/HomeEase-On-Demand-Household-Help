import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../constants/colors";

type Props = {
  steps: string[];
  currentStep: number;
};

export const StepperHorizontal: React.FC<Props> = ({ steps, currentStep }) => {
  return (
    <View className="flex-row items-center justify-between mb-4">
      {steps.map((label, index) => {
        const isActive = index === currentStep;
        const isDone = index < currentStep;
        return (
          <React.Fragment key={index}>
            <View className="items-center flex-1">
              <View
                className={`w-8 h-8 rounded-full items-center justify-center ${
                  isDone
                    ? "bg-success"
                    : isActive
                      ? "bg-accent"
                      : "bg-card border border-divider"
                }`}
              >
                {isDone ? (
                  <Ionicons name="checkmark" size={18} color={colors.white} />
                ) : (
                  <Text
                    className={`text-sm font-bold ${
                      isActive ? "text-white" : "text-text-muted"
                    }`}
                  >
                    {index + 1}
                  </Text>
                )}
              </View>
              <Text
                className={`text-xs mt-1 ${
                  isActive ? "text-brand" : "text-text-muted"
                }`}
                numberOfLines={1}
              >
                {label}
              </Text>
            </View>
            {index < steps.length - 1 && (
              <View
                className={`flex-1 h-px mx-1 ${
                  isDone ? "bg-success" : "bg-divider"
                }`}
              />
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
};

export default StepperHorizontal;
