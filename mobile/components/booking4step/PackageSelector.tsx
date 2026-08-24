import React, { useEffect, useState } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { colors } from "../../constants";
import { getWorkerPackages, type WorkerPackage } from "../../services/api";

type Props = {
  workerId: string | null | undefined;
  serviceTypeId: string | null | undefined;
  selected: string[];
  onChange: (selected: string[]) => void;
  onSelectedTotalChange?: (total: number) => void;
};

/**
 * Worker-defined priced packages for the selected worker/category — the
 * real, server-priced alternative to the old free add-on toggles. Only
 * shown once a specific worker is picked (Step 3); auto-matched ("Surprise
 * Me") bookings have no worker yet, so packages aren't offered there.
 */
export default function PackageSelector({
  workerId,
  serviceTypeId,
  selected,
  onChange,
  onSelectedTotalChange,
}: Props) {
  const [packages, setPackages] = useState<WorkerPackage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const total = packages
      .filter((p) => selected.includes(p.id))
      .reduce((sum, p) => sum + p.price, 0);
    onSelectedTotalChange?.(total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, packages]);

  useEffect(() => {
    if (!workerId) return;
    let active = true;
    Promise.resolve().then(() => {
      if (active) setLoading(true);
    });
    getWorkerPackages(workerId, serviceTypeId ?? undefined)
      .then((result) => {
        if (active) setPackages(result);
      })
      .catch((error) => {
        console.error("Load worker packages error:", error);
        if (active) setPackages([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workerId, serviceTypeId]);

  if (!workerId) return null;

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id]);
  };

  if (loading) {
    return (
      <View className="py-4 items-center">
        <ActivityIndicator size="small" color={colors.accent.DEFAULT} />
      </View>
    );
  }

  if (packages.length === 0) {
    return (
      <Text className="text-text-muted text-sm">
        This pro hasn&apos;t added any packages yet.
      </Text>
    );
  }

  return (
    <View className="gap-2">
      {packages.map((pkg) => {
        const isSelected = selected.includes(pkg.id);
        return (
          <Pressable
            key={pkg.id}
            onPress={() => toggle(pkg.id)}
            className={`bg-card rounded-xl p-3.5 flex-row items-center border-2 ${
              isSelected ? "border-accent" : "border-transparent"
            }`}
          >
            <View className="flex-1 pr-3">
              <Text className="text-text-primary font-semibold text-sm">{pkg.name}</Text>
              {pkg.description ? (
                <Text className="text-text-muted text-xs mt-0.5">{pkg.description}</Text>
              ) : null}
              <Text className="text-accent font-semibold text-sm mt-1">₱{pkg.price}</Text>
            </View>
            <Ionicons
              name={isSelected ? "checkmark-circle" : "ellipse-outline"}
              size={24}
              color={isSelected ? colors.accent.DEFAULT : colors.text.muted}
            />
          </Pressable>
        );
      })}
    </View>
  );
}
