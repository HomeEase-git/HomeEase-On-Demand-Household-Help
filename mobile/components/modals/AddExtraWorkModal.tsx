import React, { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import ModalWrapper from "./ModalWrapper";
import InputField from "../ui/InputField";
import PrimaryButton from "../ui/PrimaryButton";
import OutlinedButton from "../ui/OutlinedButton";
import { getMyTaskCatalog } from "../../services/api";

type Props = {
  visible: boolean;
  loading?: boolean;
  onConfirm: (name: string, price: number) => void;
  onCancel: () => void;
};

type Option = { id: string; name: string; price: number };

// Worker adds extra work to the job in progress (e.g. inspection -> repair).
// Their own ticked services are quick picks that prefill the Price List
// price; anything else can be typed. The client must approve it.
export const AddExtraWorkModal: React.FC<Props> = ({ visible, loading, onConfirm, onCancel }) => {
  const [options, setOptions] = useState<Option[]>([]);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");

  useEffect(() => {
    if (!visible) return;
    setName("");
    setPrice("");
    getMyTaskCatalog()
      .then((categories) =>
        setOptions(
          categories.flatMap((c) =>
            c.tasks
              .filter((t) => t.mySelection && t.task.price != null)
              .map((t) => ({ id: t.task.id, name: t.task.name, price: t.task.price as number })),
          ),
        ),
      )
      .catch(() => setOptions([]));
  }, [visible]);

  const amount = Number(price);
  const canConfirm = name.trim().length > 0 && Number.isFinite(amount) && amount > 0;

  return (
    <ModalWrapper visible={visible} onClose={onCancel} title="Add extra work">
      <Text className="text-text-secondary text-sm mb-3">
        Added to this job's bill only after the client approves it in the app.
      </Text>
      {options.length > 0 && (
        <>
          <Text className="text-text-primary font-semibold text-xs mb-2">Your services</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} className="mb-3">
            {options.map((o) => (
              <Pressable
                key={o.id}
                onPress={() => {
                  setName(o.name);
                  setPrice(String(o.price));
                }}
                className={`rounded-full px-3 py-2 border ${name === o.name ? "bg-accent/10 border-accent" : "border-divider"}`}
              >
                <Text className="text-text-primary text-xs">
                  {o.name} · ₱{o.price}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}
      <InputField label="What is the extra work?" value={name} onChangeText={setName} placeholder="e.g. Faucet repair" />
      <View className="mt-3">
        <InputField label="Price (₱)" value={price} onChangeText={setPrice} placeholder="0" keyboardType="numeric" />
      </View>
      <View className="flex-row gap-3 mt-6">
        <View className="flex-1">
          <OutlinedButton label="Back" onPress={onCancel} />
        </View>
        <View className="flex-1">
          <PrimaryButton
            label="Send to Client"
            disabled={!canConfirm || loading}
            loading={loading}
            onPress={() => canConfirm && onConfirm(name.trim(), amount)}
          />
        </View>
      </View>
    </ModalWrapper>
  );
};

export default AddExtraWorkModal;
