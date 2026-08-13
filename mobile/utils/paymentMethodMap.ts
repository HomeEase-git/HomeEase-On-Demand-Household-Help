export type ApiPaymentMethodType = "GCASH" | "MAYA" | "CASH";

// Maps the picker's lowercase ids (PaymentMethodBottomSheet / PaymentMethodSelector)
// to the backend's PaymentMethodType enum values. Only GCash, Maya, and Cash
// are supported — no card or bank transfer payment methods.
export const PAYMENT_METHOD_TYPE_MAP: Record<string, ApiPaymentMethodType> = {
  gcash: "GCASH",
  maya: "MAYA",
  cash: "CASH",
};
