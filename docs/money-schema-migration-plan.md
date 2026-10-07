# Plan: money columns, cascades and safe migrations

Status: proposal, nothing implemented yet. Covers findings #11–#13 in `docs/review-findings.md`.

The three changes depend on each other. Do them in this order:

1. Expand/contract migration rules (#12). They make the other two safe to deploy.
2. Cascade → Restrict on money records (#13). This one is small and has no data change.
3. Float → integer centavos (#11). This is the large one.

## 1. Safe migrations (#12)

**Today.** `docker-entrypoint.sh` runs `prisma migrate deploy` on every boot (`RUN_MIGRATIONS` defaults to `true`, and `render.yaml` sets it). Postgres applies the migration while the old instance is still serving. Eight migrations so far drop a table or column:

- `20260721112427_init`
- `20260818100000_replace_paymongo_with_xendit`
- `20260902070000_remove_wallet_add_debt_ledger`
- `20260904010000_reconcile_drop_admin_fee_per_job`
- `20260904030000_drop_cancellation_fee_fields`
- `20260913000000_drop_worker_hourly_rate`
- `20260913010000_custom_fields_worker_capabilities`
- `20260918130000_add_worker_service_categories`

A drop breaks the old instance's queries until it is replaced. Prisma also has no down migrations.

**Rules from now on:**

- **Expand, then contract, in separate deploys.** Deploy 1 adds the new column or table (nullable, or with a default). The code writes both the old and new shape and reads the old one. Deploy 2 backfills and switches reads to the new shape. Deploy 3 removes the old column, at least one release after nothing reads it.
- **No `DROP`, `RENAME` or `ALTER … TYPE` in the same release as the code change that stops using it.** A rename is an add-plus-backfill-plus-drop.
- **CI check.** Add a step that fails when a new `migration.sql` contains `DROP TABLE`, `DROP COLUMN`, `RENAME` or `ALTER COLUMN … TYPE`, unless the PR carries a `contract-migration` label. This is a grep in `.github/workflows/ci.yml`.
- **Backups before a contract step.** Take a Neon branch of production as the rollback point (`npm run neon:branch` already scripts branch creation). A failed contract step is rolled back by restoring that branch, not by a down migration.
- **Optional:** set `RUN_MIGRATIONS=false` on Render and run `prisma migrate deploy` as a pre-deploy command. Then a failing migration stops the deploy instead of crash-looping the new instance.

## 2. Restrict deletes of money records (#13)

**Today.** These relations use `onDelete: Cascade`. One manual `DELETE FROM "User"` would erase payment, payout, refund and dues history that the BIR requires us to keep:

- `Booking.client`
- `Booking.worker`
- `Payment.booking`
- `Payout.payment`
- `RefundRequest.payment`
- `Cancellation.booking`
- `Dispute.booking`
- `DebtLedgerEntry.workerProfile`
- `WorkerProfile.user`

The app itself never deletes these rows: account deletion anonymises the user (`accountDeletionService.ts`).

**Change.** Set `onDelete: Restrict` on:

- `Payment.booking`
- `Payout.payment`
- `RefundRequest.payment`
- `DebtLedgerEntry.workerProfile`
- `Booking.client`
- `Booking.worker`

Then a delete that would orphan money history fails instead of cascading. `Booking.worker` is optional, so `SetNull` is the alternative there. Keep Cascade on pure child rows that hold no money: `BookingVisit`, `BookingAddOn`, `LedgerLine → LedgerTransaction`.

**Watch out for:**

- Test cleanup. `tests/helpers.ts` `deleteTestUser` relies on the cascade, and so does `tests/ownerDb.ts`. Teach both to delete payouts, payments and bookings first, children before parents.
- Data-retention purge (`dataRetentionService.ts`). Check that it never deletes users that own bookings.
- This is a constraint-only migration with no data change. It is safe to ship in one deploy.

## 3. Float → integer centavos (#11)

**Today.** Only `LedgerLine.amountCentavos` is an integer. Money is a Postgres `double precision` in:

| Model | Fields |
|---|---|
| `Payment` | subtotal, tip, commissionAmount, withholdingTaxAmount, vatAmount, workerPayout, totalAmount, compensationPaid, authorizedAmount, capturedAmount |
| `Payout` | amount |
| `RefundRequest` | amount |
| `DebtLedgerEntry` | amount, balanceAfter |
| `Booking` | estimatedPrice, tip, vatAmount, laborCost, materialsCost, inspectionFeeAmount, finalPrice |
| `BookingAddOn` | price |
| `Cancellation` | penaltyAmount, compensationAmount |
| `Dispute` | refundAmount |
| `ClientProfile` | outstandingBalance |
| `WorkerProfile` | commissionOwed, compensationCredit |
| `TaxCertificate` | totalIncomePayments, totalTaxWithheld |
| `TaxRemittance` | totalTaxWithheld |
| `VatCollectionSummary` | totalVatCollected |
| `AppSettings` | noShowPenaltyAmount, clientFaultCompensationAmount, workerDebtHoldLimit, perKmFee |
| Price lists | `ServiceTask`, `ServiceType`, `WorkerTaskPrice`, `WorkerTaskTierPrice`, `WorkerPackage`, `PricingRule`, `PricingLog` |

Rates (`commissionRate`, `withholdingTaxRate`, `vatRate`, `rushFeeRate`, the tier multipliers) are not money amounts. They can stay `Float`, or become `Decimal(6,4)`.

**Target.** Store each amount as `Int` centavos with a `…Centavos` suffix, like `LedgerLine`. Convert at the API boundary only: responses keep sending pesos, so the mobile and web apps don't change.

**Steps, one model group per release, each using the expand/contract rules above:**

1. **Expand.** Add `xxxCentavos Int?` next to each Float column.
2. **Dual write.** Every write sets both values, with centavos computed by `roundToCentavo` → `Math.round(pesos * 100)`. Put this in one helper per model, so call sites don't each do it.
3. **Backfill.** Run `UPDATE … SET "xxxCentavos" = ROUND("xxx" * 100)::int WHERE "xxxCentavos" IS NULL`, in batches through `DIRECT_URL`.
4. **Verify.** Run a script that compares sums per table against the ledger (`ledgerReconciliationService.ts` already reconciles). Investigate any row where `ROUND(xxx*100) != xxxCentavos` before moving on.
5. **Switch reads.** Services compute in integer centavos. `utils/pricing.ts` and `utils/money.ts` become centavo-native. Responses convert back to pesos.
6. **Contract.** Make the centavo columns `NOT NULL`, then drop the Float columns one release later.

**Order of model groups:**

1. `Payment`, `Payout`, `RefundRequest`, `DebtLedgerEntry`: these are the ledger-adjacent ones, and drift there is what reports show.
2. `Booking` and `BookingAddOn` money fields, plus `Cancellation` and `Dispute`.
3. `WorkerProfile` and `ClientProfile` balances, and `AppSettings` amounts.
4. Tax summaries.
5. Price lists.

**Tests.** Every existing money test asserts in pesos with `toBeCloseTo`. Add exact integer assertions on the centavo columns as each group lands. Also add a property test showing that `computeBookingFinalTotal` in centavos equals the ledger posting.

**Effort.** This is multi-day work: about 25 call-site files across services, controllers and workers, plus the backfill, the verification and one release per group. Don't try it in one PR.
