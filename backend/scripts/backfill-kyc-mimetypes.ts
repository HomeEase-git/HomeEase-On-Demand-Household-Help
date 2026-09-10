// One-off backfill: KYC documents submitted through the mobile two-call flow
// (POST /users/me/kyc-documents/upload then POST /users/me/kyc-documents) were
// persisted with `mimeType = null`, which made verificationAiService filter them
// out ("No image documents were included") and the admin UI show no preview.
// The controller now derives the mime type from the Supabase URL extension on
// write; this script does the same for rows created before that fix and re-flags
// their (non-approved) verification requests so an admin can re-run the AI
// review.
//
// Usage (from backend/):
//   npx tsx scripts/backfill-kyc-mimetypes.ts --dry     # report only, no writes
//   npx tsx scripts/backfill-kyc-mimetypes.ts           # apply
//
// Respects backend/.env DATABASE_URL — point it at the target DB the same way
// the Prisma CLI does. Run against dev first.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { mimeTypeFromUrl, storagePathFromUrl } from '../src/utils/kycFileMeta';

const DRY_RUN = process.argv.includes('--dry');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const rows = await prisma.kycDocument.findMany({
    where: { mimeType: null },
    select: { id: true, fileUrl: true, fileName: true, verificationRequestId: true },
  });

  console.log(`Found ${rows.length} KycDocument row(s) with mimeType = null.`);
  if (!rows.length) return;

  let updated = 0;
  let unresolved = 0;
  const affectedRequestIds = new Set<string>();

  for (const row of rows) {
    const mimeType = mimeTypeFromUrl(row.fileUrl);
    if (!mimeType) {
      unresolved++;
      console.warn(`  ? ${row.id}  could not derive mime from: ${row.fileUrl}`);
      continue;
    }
    const fileName = row.fileName ?? storagePathFromUrl(row.fileUrl);
    console.log(`  ${DRY_RUN ? '[dry] ' : ''}${row.id}  -> ${mimeType}`);
    if (!DRY_RUN) {
      await prisma.kycDocument.update({
        where: { id: row.id },
        data: { mimeType, fileName },
      });
    }
    updated++;
    affectedRequestIds.add(row.verificationRequestId);
  }

  // Re-flag the touched requests (unless already approved) so the admin queue
  // shows them as pending and "Re-run AI Review" produces a real assessment.
  const requeue = await prisma.verificationRequest.findMany({
    where: { id: { in: [...affectedRequestIds] }, status: { not: 'APPROVED' } },
    select: { id: true },
  });

  if (!DRY_RUN && requeue.length) {
    await prisma.verificationRequest.updateMany({
      where: { id: { in: requeue.map((r) => r.id) } },
      data: { aiStatus: 'PENDING', aiSummary: null, aiConfidence: null, aiError: null },
    });
  }

  console.log(
    `\n${DRY_RUN ? '[dry] would update' : 'Updated'} ${updated} document(s); ` +
      `${unresolved} unresolved; ` +
      `${DRY_RUN ? 'would re-flag' : 're-flagged'} ${requeue.length} non-approved verification request(s) for AI re-review.`
  );
  if (requeue.length) {
    console.log('Re-run each from the admin verification detail screen ("Re-run AI Review").');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
