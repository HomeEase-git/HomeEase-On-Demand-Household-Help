import { Prisma } from '@prisma/client';

export function formatVerification(
  record: Prisma.VerificationRequestGetPayload<{ include: { user: true; documents: true } }>
) {
  const documentTypes = record.documents.map((doc) => doc.documentType).filter(Boolean);

  return {
    id: record.id,
    name: record.user.fullName,
    email: record.user.email,
    phone: record.user.phone,
    userId: record.user.id,
    type: record.type.toLowerCase(),
    documentType: documentTypes[0] ? documentTypes[0].toLowerCase() : 'unknown',
    services: documentTypes.length ? documentTypes.join(', ') : '—',
    status: record.status,
    rejectReason: record.rejectionReason ?? null,
    adminOverrideReason: record.adminOverrideReason ?? null,
    aiStatus: record.aiStatus ?? 'PENDING',
    aiSummary: record.aiSummary ?? null,
    aiConfidence: record.aiConfidence ?? null,
    aiError: record.aiError ?? null,
    submitted: record.submittedAt.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }),
    documents: record.documents.map((doc) => ({
      id: doc.id,
      name: doc.originalName ?? doc.fileName ?? 'document',
      documentType: doc.documentType,
      mimeType: doc.mimeType,
      url: doc.fileUrl,
      fileSize: doc.fileSize ?? 0,
      uploadedAt: doc.createdAt.toISOString(),
      status: doc.status,
      rejectionReason: doc.rejectionReason ?? null,
    })),
  };
}

export function formatDisplayId(id: string) {
  return `#${id.slice(-6).toUpperCase()}`;
}

export function formatPeso(amount: number) {
  return `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
