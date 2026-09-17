// One-off backfill: adminVerificationController.approveVerification now
// auto-creates a placeholder Certification (visible in Profile > My
// Certifications) from any submitted CERTIFICATION KYC document at the
// moment the verification is approved. That only fires going forward —
// workers whose verification was already APPROVED before this fix shipped
// submitted a certification that's still sitting invisible in the
// admin-only KYC review. This script applies the same backfill to them.
//
// Usage (from backend/):
//   npx tsx scripts/backfill-certifications-from-kyc.ts --dry     # report only, no writes
//   npx tsx scripts/backfill-certifications-from-kyc.ts           # apply
//
// Respects backend/.env DATABASE_URL — point it at the target DB the same
// way the Prisma CLI does. Run against dev first.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const DRY_RUN = process.argv.includes('--dry');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function titleFromDocumentName(originalName: string | null): string {
  const base = (originalName ?? '').replace(/\.[^./]+$/, '').replace(/[_-]+/g, ' ').trim();
  return base || 'Certification (from KYC submission)';
}

async function main() {
  const docs = await prisma.kycDocument.findMany({
    where: {
      documentType: 'CERTIFICATION',
      verificationRequest: { status: 'APPROVED' },
    },
    select: {
      fileUrl: true,
      originalName: true,
      verificationRequest: { select: { userId: true } },
    },
  });

  console.log(`Found ${docs.length} approved CERTIFICATION document(s).`);
  if (!docs.length) return;

  let created = 0;
  let skippedExisting = 0;
  let skippedNoProfile = 0;

  for (const doc of docs) {
    const userId = doc.verificationRequest.userId;
    const workerProfile = await prisma.workerProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!workerProfile) {
      skippedNoProfile++;
      console.warn(`  ? user ${userId} has no WorkerProfile — skipping ${doc.fileUrl}`);
      continue;
    }

    const existing = await prisma.certification.findFirst({
      where: { workerProfileId: workerProfile.id, documentUrl: doc.fileUrl },
      select: { id: true },
    });
    if (existing) {
      skippedExisting++;
      continue;
    }

    const title = titleFromDocumentName(doc.originalName);
    console.log(`  ${DRY_RUN ? '[dry] would create' : 'creating'}: "${title}" for user ${userId}`);

    if (!DRY_RUN) {
      const certification = await prisma.certification.create({
        data: {
          workerProfileId: workerProfile.id,
          title,
          issuer: 'Not yet specified',
          issueDate: new Date(),
          documentUrl: doc.fileUrl,
        },
      });

      await prisma.notification.create({
        data: {
          userId,
          type: 'CERTIFICATION_NEEDS_DETAILS',
          title: 'Add details to your certification',
          message: `We added "${title}" to My Certifications from your submitted documents. Add the issuer and date so it can be reviewed.`,
          relatedId: certification.id,
        },
      });
    }
    created++;
  }

  console.log(
    `\n${DRY_RUN ? '[dry] would create' : 'Created'} ${created} Certification record(s); ` +
      `${skippedExisting} already had one; ${skippedNoProfile} skipped (no WorkerProfile).`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
