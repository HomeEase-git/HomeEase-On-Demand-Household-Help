export type ApiPaymentMethodType = "GCASH" | "MAYA" | "CASH";

export const PAYMENT_METHOD_TYPE_MAP: Record<string, ApiPaymentMethodType> = {
  gcash: "GCASH",
  maya: "MAYA",
  cash: "CASH",
};
