import { Prisma } from '@prisma/client';
import prisma from '@config/database';

export type AuditCategory = 'ADMIN_ACTION' | 'LOGIN' | 'SYSTEM_ERROR' | 'STATUS_CHANGE';
export type AuditLevel = 'INFO' | 'WARN' | 'ERROR';

interface AuditLogEntry {
  actorId?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  action: string;
  category: AuditCategory;
  level?: AuditLevel;
  message: string;
  metadata?: Record<string, unknown>;
}

// Best-effort — a logging failure must never break the primary action it's
// attached to, so this swallows its own errors instead of throwing.
export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        actorName: entry.actorName ?? null,
        actorRole: entry.actorRole ?? null,
        action: entry.action,
        category: entry.category,
        level: entry.level ?? 'INFO',
        message: entry.message,
        metadata: entry.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (error) {
    console.error('Audit log write failed:', error);
  }
}
