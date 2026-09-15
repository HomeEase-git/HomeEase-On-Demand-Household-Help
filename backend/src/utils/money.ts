/**
 * Shared money-rounding helper.
 *
 * All money amounts in this codebase are Philippine-peso denominated and
 * stored as plain `number` (Float) columns — see the note on Payment/
 * WorkerProfile.commissionOwed in schema.prisma. Peso amounts are only ever
 * meaningful to centavo precision (2 decimal places), but rounding to that
 * precision used to be done ad hoc at each write site (`Math.round(x * 100)
 * / 100`, `.toFixed(2)`, etc.) — harmless individually, but a real source of
 * centavo-level drift if any one site's formula differs even slightly from
 * another's (e.g. rounding before vs. after summing several fields).
 *
 * This does NOT change the underlying numeric representation to a Decimal
 * type — that's a separate, much larger schema-wide change. This is only
 * about making the *rounding* consistent across call sites.
 */
export function roundToCentavo(amount: number): number {
  return Math.round(amount * 100) / 100;
}
