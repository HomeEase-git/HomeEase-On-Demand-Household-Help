import React from "react";
import { View, Text, Switch, ActivityIndicator } from "react-native";
import { colors } from "../../constants";

type Props = {
  /** null while it's still loading. */
  isAvailable: boolean | null;
  saving: boolean;
  onChange: (value: boolean) => void;
  /** Account setup isn't finished, so requests can't reach them even when online. */
  setupIncomplete?: boolean;
};

/** The worker's Online/Offline switch — whether new job requests can reach them. */
export const AvailabilityToggle: React.FC<Props> = ({ isAvailable, saving, onChange, setupIncomplete }) => {
  const online = isAvailable === true;
  const reachable = online && !setupIncomplete;
  return (
    <View
      className={`flex-row items-center rounded-2xl p-4 mx-4 mt-3 border ${
        reachable ? "bg-success/10 border-success/30" : "bg-card border-divider"
      }`}
    >
      <View className={`w-3 h-3 rounded-full mr-3 ${reachable ? "bg-success" : "bg-neutral-400"}`} />
      <View className="flex-1 mr-3">
        <Text className="text-text-primary font-bold text-base">
          {isAvailable === null ? "Checking…" : online ? "You're online" : "You're offline"}
        </Text>
        <Text className="text-text-secondary text-xs mt-0.5">
          {!online
            ? "You won't get new job requests until you go online."
            : setupIncomplete
              ? "Finish your account setup before job requests can reach you."
              : "New job requests can reach you."}
        </Text>
      </View>
      {saving || isAvailable === null ? (
        <ActivityIndicator color={colors.brand.DEFAULT} />
      ) : (
        <Switch
          value={online}
          onValueChange={onChange}
          trackColor={{ false: colors.toggleOff, true: colors.success }}
          thumbColor={colors.white}
          accessibilityLabel={online ? "Go offline" : "Go online"}
        />
      )}
    </View>
  );
};

export default AvailabilityToggle;
