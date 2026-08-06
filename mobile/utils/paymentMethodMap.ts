export type ApiPaymentMethodType = "GCASH" | "MAYA" | "CARD" | "BANK_TRANSFER" | "CASH";

// Maps the picker's lowercase ids (PaymentMethodBottomSheet / PaymentMethodSelector)
// to the backend's PaymentMethodType enum values. Apple Pay and Google Pay have
// no dedicated backend enum value — both settle as CARD (PayMongo's manual-capture
// Payment Intent flow), same as a manually-entered card; the distinction is purely
// which wallet UI collected it on the client.
export const PAYMENT_METHOD_TYPE_MAP: Record<string, ApiPaymentMethodType> = {
  gcash: "GCASH",
  maya: "MAYA",
  bank: "BANK_TRANSFER",
  cash: "CASH",
  card: "CARD",
  apple_pay: "CARD",
  google_pay: "CARD",
};
