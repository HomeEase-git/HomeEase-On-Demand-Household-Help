import React from "react";
import { View, Text, Pressable } from "react-native";
import { RemoteImage } from "../ui/RemoteImage";
import type { ApiInvoice, InvoiceLine } from "../../utils/mapBookingDetail";

const KIND_LABEL: Record<InvoiceLine["kind"], string> = {
  JOB: "Job",
  PACKAGE: "Package",
  PREFERENCE: "Preference",
  PART: "Part (with receipt)",
  EXTRA_WORK: "Extra work",
};

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Props = {
  invoice: ApiInvoice;
  // Omit to show the photos without opening them full screen.
  onOpenPhoto?: (url: string) => void;
};

/**
 * The bill the worker sends when the job is done: the job, then any package,
 * part (with its receipt) or extra work (with a photo), the tip and the total.
 * Shared by the client's booking screen and the worker's job screen.
 */
export const InvoiceCard: React.FC<Props> = ({ invoice, onOpenPhoto }) => (
  <View className="bg-card rounded-2xl p-4 mb-3">
    <View className="flex-row items-center justify-between mb-3">
      <Text className="text-text-primary font-bold text-base">Invoice</Text>
      {!!invoice.sentAt && (
        <Text className="text-text-muted text-xs">
          Sent {new Date(invoice.sentAt).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}
        </Text>
      )}
    </View>

    {invoice.lines.map((line, i) => (
      <View key={line.id ?? `job-${i}`} className="mb-3">
        <View className="flex-row justify-between">
          <View className="flex-1 pr-3">
            <Text className="text-text-primary text-base">{line.name}</Text>
            <Text className="text-text-muted text-xs">{KIND_LABEL[line.kind] ?? "Item"}</Text>
          </View>
          <Text className="text-text-primary text-base font-semibold">{peso(line.price)}</Text>
        </View>
        {line.photoUrls.length > 0 && (
          <View className="flex-row flex-wrap gap-2 mt-2">
            {line.photoUrls.map((url) => (
              <Pressable
                key={url}
                disabled={!onOpenPhoto}
                onPress={() => onOpenPhoto?.(url)}
                accessibilityRole="imagebutton"
                accessibilityLabel={`Open photo for ${line.name}`}
              >
                <RemoteImage source={{ uri: url }} className="w-16 h-16 rounded-lg bg-card-dark" />
              </Pressable>
            ))}
          </View>
        )}
      </View>
    ))}

    {invoice.vatAmount > 0 && (
      <View className="flex-row justify-between mb-2">
        <Text className="text-text-secondary text-base">VAT</Text>
        <Text className="text-text-primary text-base">{peso(invoice.vatAmount)}</Text>
      </View>
    )}
    {invoice.tip > 0 && (
      <View className="flex-row justify-between mb-2">
        <Text className="text-text-secondary text-base">Tip</Text>
        <Text className="text-text-primary text-base">{peso(invoice.tip)}</Text>
      </View>
    )}
    <View className="border-t border-divider pt-3 flex-row justify-between">
      <Text className="text-text-primary font-bold text-lg">Total</Text>
      <Text className="text-text-primary font-bold text-lg">{peso(invoice.total)}</Text>
    </View>
  </View>
);

export default InvoiceCard;
