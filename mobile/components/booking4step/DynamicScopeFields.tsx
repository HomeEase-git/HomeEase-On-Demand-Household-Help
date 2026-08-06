import React from "react";
import { View, Text, Pressable } from "react-native";
import InputField from "../ui/InputField";
import type { ScopeField } from "../../types/booking4step.types";

type Props = {
  fields: ScopeField[];
  answers: Record<string, string | string[]>;
  onChange: (answers: Record<string, string | string[]>) => void;
};

/**
 * Renders an admin-defined set of scope questions for services whose
 * ServiceType.scopeType is CUSTOM (e.g. "Appliance Type" for Appliance
 * Repair) — the alternative to the generic RoomSelector used by ROOM_BASED
 * services. Answers are keyed by field id locally, then remapped to field
 * *label* when written to the booking draft (see step-1.tsx), matching how
 * the backend snapshots them onto Booking.scopeAnswers.
 */
export default function DynamicScopeFields({ fields, answers, onChange }: Props) {
  const setAnswer = (fieldId: string, value: string | string[]) => {
    onChange({ ...answers, [fieldId]: value });
  };

  const toggleMultiOption = (fieldId: string, option: string) => {
    const current = answers[fieldId];
    const selected = Array.isArray(current) ? current : [];
    setAnswer(fieldId, selected.includes(option) ? selected.filter((o) => o !== option) : [...selected, option]);
  };

  return (
    <View className="gap-5">
      {fields.map((field) => {
        const value = answers[field.id];
        return (
          <View key={field.id}>
            <Text className="text-text-secondary font-bold text-sm mb-2">
              {field.label}
              {field.required ? " *" : " (optional)"}
            </Text>

            {field.fieldType === "TEXT" && (
              <InputField
                label=""
                value={typeof value === "string" ? value : ""}
                onChangeText={(t) => setAnswer(field.id, t)}
                placeholder={`Enter ${field.label.toLowerCase()}`}
                multiline
              />
            )}

            {(field.fieldType === "SELECT" || field.fieldType === "MULTI_SELECT") && (
              <View className="flex-row flex-wrap gap-2">
                {field.options.map((option) => {
                  const isSelected =
                    field.fieldType === "SELECT" ? value === option.label : Array.isArray(value) && value.includes(option.label);
                  return (
                    <Pressable
                      key={option.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      onPress={() =>
                        field.fieldType === "SELECT"
                          ? setAnswer(field.id, option.label)
                          : toggleMultiOption(field.id, option.label)
                      }
                      className={`rounded-full px-4 py-2.5 border ${
                        isSelected ? "bg-accent border-accent" : "bg-card border-divider"
                      }`}
                    >
                      <Text className={`font-medium text-sm ${isSelected ? "text-white" : "text-text-secondary"}`}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}
