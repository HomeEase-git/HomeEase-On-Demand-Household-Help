const PH_MOBILE_NUMBER_PATTERN = /^(09\d{9}|\+639\d{9})$/;

export function isPhMobileNumber(value: string): boolean {
  return PH_MOBILE_NUMBER_PATTERN.test(value.trim());
}
