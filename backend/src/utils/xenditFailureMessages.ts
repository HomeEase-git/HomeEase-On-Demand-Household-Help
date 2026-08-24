/**
 * Translates Xendit's raw failure/status codes (invoice payment failures,
 * worker payout failures) into short, actionable messages for the mobile
 * app.
 *
 * BEST-EFFORT / UNCONFIRMED: Xendit's exact failure-code vocabulary could
 * not be verified against live docs when this was built (network-blocked).
 * This list is drawn from Xendit's commonly-documented Invoice and Payout
 * failure/status codes and matched by substring the same defensive way the
 * old PayMongo version was — replace/extend once real failed webhook
 * payloads are observed in the Xendit dashboard.
 */
const FAILURE_REASON_PATTERNS: Array<{ match: RegExp; message: string }> = [
  {
    match: /insufficient[_ ]?balance/i,
    message: 'Your balance is too low to complete this payment. Please top up and try again.',
  },
  {
    match: /expired/i,
    message: 'This payment request expired before it was completed. Please try again.',
  },
  {
    match: /declined|customer[_ ]?declined|payment[_ ]?failed/i,
    message: 'The payment was declined. Please try again or use a different payment method.',
  },
  {
    match: /destination[_ ]?account[_ ]?invalid|account[_ ]?number[_ ]?blocked|account[_ ]?not[_ ]?found|invalid[_ ]?account/i,
    message: "The account details couldn't be verified. Please check and try again.",
  },
  {
    match: /channel[_ ]?not[_ ]?supported|channel[_ ]?unavailable/i,
    message: "This payment method isn't available right now. Try a different one.",
  },
  {
    match: /timeout|timed[_ ]?out/i,
    message: 'The payment timed out before it could be confirmed. Please try again.',
  },
];

const DEFAULT_MESSAGE = "The payment couldn't be completed. Please try again or use a different payment method.";

export function translateXenditFailureReason(rawReason: string | null | undefined): string {
  if (!rawReason) return DEFAULT_MESSAGE;
  const matched = FAILURE_REASON_PATTERNS.find(({ match }) => match.test(rawReason));
  return matched?.message ?? DEFAULT_MESSAGE;
}
