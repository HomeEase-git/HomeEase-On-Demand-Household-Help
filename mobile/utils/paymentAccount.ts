// GCash/Maya account = a PH mobile number, local (09XXXXXXXXX) or
// international (+639XXXXXXXXX). Shared by Step 4 and Add Payment Method.
const PH_MOBILE_NUMBER_PATTERN = /^(09\d{9}|\+639\d{9})$/;

export function isPhMobileNumber(value: string): boolean {
  return PH_MOBILE_NUMBER_PATTERN.test(value.trim());
}
