import React, { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import ModalWrapper from "./ModalWrapper";
import InputField from "../ui/InputField";
import PrimaryButton from "../ui/PrimaryButton";
import OutlinedButton from "../ui/OutlinedButton";
import ProofPhotosField from "../booking/ProofPhotosField";
import { getMyTaskCatalog, type InvoiceItemPayload } from "../../services/api";

type Props = {
  visible: boolean;
  bookingId: string;
  kind: InvoiceItemPayload["kind"];
  onConfirm: (item: InvoiceItemPayload) => void;
  onCancel: () => void;
};

type Option = { id: string; name: string; price: number };

const COPY = {
  PART: {
    title: "Add a part",
    intro: "Parts or materials you bought for this job. The client sees the receipt on the invoice.",
    nameLabel: "What did you buy?",
    namePlaceholder: "e.g. Outlet cover",
    photoLabel: "Photo of the receipt",
  },
  EXTRA_WORK: {
    title: "Add extra work",
    intro: "Work you did beyond what was booked. The client sees it on the invoice.",
    nameLabel: "What extra work did you do?",
    namePlaceholder: "e.g. Installed a second outlet",
    photoLabel: "Photo of the work",
  },
} as const;

// A line the worker adds to the invoice before sending it. Extra work offers
// the worker's own services as quick picks at their Price List price.
export const InvoiceLineModal: React.FC<Props> = ({ visible, bookingId, kind, onConfirm, onCancel }) => {
  const [options, setOptions] = useState<Option[]>([]);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const copy = COPY[kind];

  // The parent remounts this per line (key), so the form starts empty.
  useEffect(() => {
    if (!visible || kind !== "EXTRA_WORK") return;
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
  }, [visible, kind]);

  const amount = Number(price);
  const canConfirm = name.trim().length > 0 && Number.isFinite(amount) && amount > 0 && photoUrls.length > 0;

  return (
    <ModalWrapper visible={visible} onClose={onCancel} title={copy.title}>
      <Text className="text-text-secondary text-sm mb-3">{copy.intro}</Text>
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
      <InputField label={copy.nameLabel} value={name} onChangeText={setName} placeholder={copy.namePlaceholder} />
      <View className="mt-3">
        <InputField label="Price (₱)" value={price} onChangeText={setPrice} placeholder="0" keyboardType="numeric" />
      </View>
      <View className="mt-3">
        <ProofPhotosField bookingId={bookingId} label={copy.photoLabel} urls={photoUrls} onChange={setPhotoUrls} required />
      </View>
      <View className="flex-row gap-3 mt-2">
        <View className="flex-1">
          <OutlinedButton label="Back" onPress={onCancel} />
        </View>
        <View className="flex-1">
          <PrimaryButton
            label="Add to Invoice"
            disabled={!canConfirm}
            onPress={() => canConfirm && onConfirm({ kind, name: name.trim(), price: amount, photoUrls })}
          />
        </View>
      </View>
    </ModalWrapper>
  );
};

export default InvoiceLineModal;
