/**
 * Translates PayMongo's raw failure reason strings (client checkout
 * failures, worker payout/disbursement failures) into short, actionable
 * messages for the mobile app — PayMongo's own strings are inconsistent in
 * casing/format and not written for end users. Matched by substring since
 * PayMongo doesn't document a stable enum of these values.
 */
const FAILURE_REASON_PATTERNS: Array<{ match: RegExp; message: string }> = [
  {
    match: /insufficient[_ ]?balance|insufficient[_ ]?funds/i,
    message: 'Your GCash balance is too low to complete this payment. Please top up and try again.',
  },
  {
    match: /account[_ ]?not[_ ]?linked|payment[_ ]?method[_ ]?not[_ ]?allowed|source[_ ]?not[_ ]?allowed/i,
    message: "This GCash account can't be linked for this payment. Try a different payment method.",
  },
  {
    match: /expired/i,
    message: 'This payment request expired before it was completed. Please try again.',
  },
  {
    match: /cancelled|canceled|user[_ ]?cancel/i,
    message: 'The payment was cancelled before it completed.',
  },
  {
    match: /invalid[_ ]?account|account[_ ]?not[_ ]?found|recipient[_ ]?not[_ ]?found/i,
    message: "The GCash account details couldn't be verified. Please check and try again.",
  },
];

const DEFAULT_MESSAGE = "The payment couldn't be completed. Please try again or use a different payment method.";

export function translatePaymongoFailureReason(rawReason: string | null | undefined): string {
  if (!rawReason) return DEFAULT_MESSAGE;
  const matched = FAILURE_REASON_PATTERNS.find(({ match }) => match.test(rawReason));
  return matched?.message ?? DEFAULT_MESSAGE;
}
