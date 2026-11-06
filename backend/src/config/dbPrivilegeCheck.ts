import type { PrismaClient } from '@prisma/client';
import prisma from '@config/database';

export async function checkDatabasePrivileges(db: PrismaClient = prisma): Promise<string[]> {
  const [row] = await db.$queryRaw<
    [{ role: string; superuser: boolean; canCreate: boolean; ownsTables: boolean; canEditAudit: boolean }]
  >`
    SELECT current_user::text AS role,
      (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
      has_schema_privilege(current_user, 'public', 'CREATE') AS "canCreate",
      EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user) AS "ownsTables",
      (has_table_privilege(current_user, 'public."AuditLog"', 'UPDATE')
        OR has_table_privilege(current_user, 'public."AuditLog"', 'DELETE')) AS "canEditAudit"`;

  const fix = 'Point DATABASE_URL at the homeease_app role (docs/DATA-RESILIENCE.md, "Database roles").';
  if (row.superuser || row.canCreate || row.ownsTables) {
    return [
      `DATABASE_URL signs in as "${row.role}", which can alter or drop tables, so a bug or injection in the app could too. ${fix}`,
    ];
  }
  if (row.canEditAudit) {
    return [`DATABASE_URL signs in as "${row.role}", which can edit or delete audit log entries. ${fix}`];
  }
  return [];
}
