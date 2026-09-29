import prisma from '@config/database';
import { checkDatabasePrivileges } from '@config/dbPrivilegeCheck';
import { ownerDb } from './ownerDb';

// CI runs the suite as homeease_app (scripts/db-roles.ts), the role
// production's DATABASE_URL should use; the second block only runs then.
let currentRole = '';
beforeAll(async () => {
  [{ currentRole }] = await prisma.$queryRaw<[{ currentRole: string }]>`SELECT current_user AS "currentRole"`;
});

describe('checkDatabasePrivileges', () => {
  it('warns when the app signs in as a role that can change the schema', async () => {
    const warnings = await checkDatabasePrivileges(ownerDb);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/can alter or drop tables/);
  });
});

const asAppRole = process.env.DATABASE_URL?.includes('homeease_app') ? describe : describe.skip;

asAppRole('as the homeease_app role', () => {
  it('is the role in use, and the startup check has nothing to report', async () => {
    expect(currentRole).toBe('homeease_app');
    expect(await checkDatabasePrivileges()).toEqual([]);
  });

  it('can add audit entries but not change or delete them', async () => {
    const entry = await prisma.auditLog.create({
      data: { action: 'ROLE_TEST', category: 'SYSTEM_ERROR', message: 'role test' },
    });
    await expect(prisma.auditLog.update({ where: { id: entry.id }, data: { message: 'edited' } })).rejects.toThrow(/permission denied/);
    await expect(prisma.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(/permission denied/);
    await ownerDb.auditLog.delete({ where: { id: entry.id } });
  });

  it('cannot rewrite ledger entries', async () => {
    await expect(
      prisma.ledgerLine.updateMany({ where: { id: 'no-such-line' }, data: { amountCentavos: 0 } }),
    ).rejects.toThrow(/permission denied/);
    await expect(prisma.ledgerTransaction.deleteMany({ where: { id: 'no-such-transaction' } })).rejects.toThrow(/permission denied/);
  });

  it('cannot create or drop tables', async () => {
    await expect(prisma.$executeRawUnsafe('CREATE TABLE role_test (id int)')).rejects.toThrow(/permission denied/);
    await expect(prisma.$executeRawUnsafe('DROP TABLE "Notification"')).rejects.toThrow(/must be owner/);
  });
});
