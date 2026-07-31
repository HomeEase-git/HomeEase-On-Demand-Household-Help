export type ApiPaymentMethodType = "GCASH" | "MAYA" | "CARD" | "BANK_TRANSFER" | "CASH";

// Maps the picker's lowercase ids (PaymentMethodBottomSheet) to the backend's
// PaymentMethodType enum values.
export const PAYMENT_METHOD_TYPE_MAP: Record<string, ApiPaymentMethodType> = {
  gcash: "GCASH",
  maya: "MAYA",
  bank: "BANK_TRANSFER",
  cash: "CASH",
};
