import React, { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import BottomSheetWrapper, { BottomSheetHandle } from "./BottomSheetWrapper";
import { getServiceTypes } from "../../services/api";
import { colors, cardShadow } from "../../constants";

type Props = {
  innerRef: React.RefObject<BottomSheetHandle | null>;
  onSelect: (name: string, id: string) => void;
};

export const ServiceTypePickerBottomSheet: React.FC<Props> = ({
  innerRef,
  onSelect,
}) => {
  const [services, setServices] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    getServiceTypes().then(setServices).catch(console.error);
  }, []);

  return (
    <BottomSheetWrapper
      innerRef={innerRef}
      snapPoints={["50%"]}
      title="Select service"
    >
      <ScrollView className="max-h-64">
        {services.map((service) => (
          <Pressable
            key={service.id}
            className="bg-white rounded-2xl py-3.5 px-4 mb-2 flex-row items-center"
            style={cardShadow}
            onPress={() => onSelect(service.name, service.id)}
          >
            <View className="w-9 h-9 rounded-full bg-accent/10 items-center justify-center mr-3">
              <Ionicons name="construct-outline" size={18} color={colors.accent.DEFAULT} />
            </View>
            <Text className="text-text-primary font-semibold flex-1">{service.name}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.text.muted} />
          </Pressable>
        ))}
      </ScrollView>
    </BottomSheetWrapper>
  );
};

export default ServiceTypePickerBottomSheet;
