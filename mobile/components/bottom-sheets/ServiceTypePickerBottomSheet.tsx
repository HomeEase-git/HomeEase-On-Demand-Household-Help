import React, { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import BottomSheetWrapper, { BottomSheetHandle } from "./BottomSheetWrapper";
import { getServiceTypes } from "../../services/api";

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
            className="bg-card-light rounded-xl py-4 px-4 mb-2"
            onPress={() => onSelect(service.name, service.id)}
          >
            <Text className="text-primary font-semibold">{service.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </BottomSheetWrapper>
  );
};

export default ServiceTypePickerBottomSheet;
