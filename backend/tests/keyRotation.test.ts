import path from 'path';
import { execFileSync } from 'child_process';
import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { decrypt, encrypt, isUnderPreviousKey } from '@utils/encryption';
import {
  decryptField,
  encryptField,
  hashTin,
  isUnderPreviousDataKey,
  tinHashCandidates,
} from '@utils/fieldEncryption';
import { createTestUser, deleteTestUser } from './helpers';

const OLD_DATA = 'o'.repeat(64);
const NEW_DATA = 'n'.repeat(64);
const OLD_MFA = 'p'.repeat(64);
const NEW_MFA = 'q'.repeat(64);

const saved = {
  data: process.env.DATA_ENCRYPTION_KEY,
  dataPrevious: process.env.DATA_ENCRYPTION_KEY_PREVIOUS,
  mfa: process.env.MFA_ENCRYPTION_KEY,
  mfaPrevious: process.env.MFA_ENCRYPTION_KEY_PREVIOUS,
};

function useKeys(keys: { data?: string; dataPrevious?: string; mfa?: string; mfaPrevious?: string }) {
  const set = (name: string, value?: string) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  set('DATA_ENCRYPTION_KEY', keys.data);
  set('DATA_ENCRYPTION_KEY_PREVIOUS', keys.dataPrevious);
  set('MFA_ENCRYPTION_KEY', keys.mfa);
  set('MFA_ENCRYPTION_KEY_PREVIOUS', keys.mfaPrevious);
}

afterAll(() => {
  useKeys(saved);
});

describe('encryption key rotation (unit)', () => {
  it('reads values under the previous key and writes new ones under the current key', () => {
    useKeys({ data: OLD_DATA });
    const old = encryptField('09171234567');

    useKeys({ data: NEW_DATA, dataPrevious: OLD_DATA });
    expect(decryptField(old)).toBe('09171234567');
    expect(isUnderPreviousDataKey(old)).toBe(true);

    const fresh = encryptField('09171234567');
    expect(isUnderPreviousDataKey(fresh)).toBe(false);

    // Without the previous key, old values no longer read — hence the script.
    useKeys({ data: NEW_DATA });
    expect(() => decryptField(old)).toThrow();
    expect(decryptField(fresh)).toBe('09171234567');
  });

  it('offers the TIN hash under every key during a rotation', () => {
    useKeys({ data: OLD_DATA });
    const oldHash = hashTin('123-456-789');
    useKeys({ data: NEW_DATA, dataPrevious: OLD_DATA });
    expect(tinHashCandidates('123-456-789')).toEqual([hashTin('123-456-789'), oldHash]);
    expect(hashTin('123-456-789')).not.toBe(oldHash);
  });

  it('does the same for admin MFA secrets', () => {
    useKeys({ mfa: OLD_MFA });
    const old = encrypt('JBSWY3DPEHPK3PXP');
    useKeys({ mfa: NEW_MFA, mfaPrevious: OLD_MFA });
    expect(decrypt(old)).toBe('JBSWY3DPEHPK3PXP');
    expect(isUnderPreviousKey(old)).toBe(true);
    expect(isUnderPreviousKey(encrypt('x'))).toBe(false);
  });
});

describe('encryption key rotation (database)', () => {
  const createdUserIds: string[] = [];

  const runScript = (extraArgs: string[] = []) =>
    execFileSync(process.execPath, [require.resolve('tsx/cli'), path.join(__dirname, '../scripts/rotate-encryption-keys.ts'), ...extraArgs], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        DATA_ENCRYPTION_KEY: NEW_DATA,
        DATA_ENCRYPTION_KEY_PREVIOUS: OLD_DATA,
        MFA_ENCRYPTION_KEY: NEW_MFA,
        MFA_ENCRYPTION_KEY_PREVIOUS: OLD_MFA,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

  /** Runs the script expecting failure; returns its combined output. */
  const runScriptExpectingFailure = (): string => {
    try {
      runScript();
    } catch (error) {
      const { stdout, stderr } = error as { stdout: string; stderr: string };
      return `${stdout}${stderr}`;
    }
    throw new Error('expected the rotation script to fail');
  };

  afterAll(async () => {
    for (const id of createdUserIds) await deleteTestUser(id);
    await prisma.taxCertificate.deleteMany({ where: { workerName: 'Rotation Test' } });
    await prisma.$disconnect();
  });

  it('blocks a duplicate TIN that is still hashed under the previous key', async () => {
    useKeys({ data: OLD_DATA });
    const { user: first } = await createTestUser('rotation-tin-a', { role: 'WORKER' });
    createdUserIds.push(first.id);
    await prisma.workerProfile.update({
      where: { userId: first.id },
      data: { tin: encryptField('111-222-333'), tinHash: hashTin('111-222-333') },
    });

    useKeys({ data: NEW_DATA, dataPrevious: OLD_DATA });
    const { user: second, plainPassword } = await createTestUser('rotation-tin-b', { role: 'WORKER' });
    createdUserIds.push(second.id);
    const login = await request(app).post('/api/auth/login').send({ email: second.email, password: plainPassword });

    const res = await request(app)
      .patch('/api/workers/me/tax-info')
      .set('Authorization', `Bearer ${login.body.data.token}`)
      .send({ tin: '111-222-333' });
    expect(res.status).toBe(409);
  });

  it('the rotation script moves every value to the new key and rehashes TINs', async () => {
    useKeys({ data: OLD_DATA, mfa: OLD_MFA });
    const { user: worker } = await createTestUser('rotation-script', { role: 'WORKER' });
    const { user: admin } = await createTestUser('rotation-script-admin', { role: 'ADMIN' });
    createdUserIds.push(worker.id, admin.id);
    await prisma.workerProfile.update({
      where: { userId: worker.id },
      data: {
        payoutAccountNumber: encryptField('09998887777'),
        tin: encryptField('444-555-666'),
        tinHash: hashTin('444-555-666'),
      },
    });
    const certificate = await prisma.taxCertificate.create({
      data: {
        workerId: worker.id,
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-03-31'),
        workerName: 'Rotation Test',
        workerTin: encryptField('444-555-666'),
        totalIncomePayments: 0,
        totalTaxWithheld: 0,
        pdfPath: 'x.pdf',
        generatedBy: admin.id,
      },
    });
    await prisma.mfaSecret.create({ data: { userId: admin.id, secretEncrypted: encrypt('JBSWY3DPEHPK3PXP'), pending: false } });

    const before = await prisma.workerProfile.findUniqueOrThrow({ where: { userId: worker.id } });
    const dryOutput = runScript(['--dry']);
    expect(dryOutput).toMatch(/DRY RUN/);
    expect((await prisma.workerProfile.findUniqueOrThrow({ where: { userId: worker.id } })).tin).toBe(before.tin);

    runScript();

    // Only the new keys now: everything must still read.
    useKeys({ data: NEW_DATA, mfa: NEW_MFA });
    const after = await prisma.workerProfile.findUniqueOrThrow({ where: { userId: worker.id } });
    expect(decryptField(after.payoutAccountNumber!)).toBe('09998887777');
    expect(decryptField(after.tin!)).toBe('444-555-666');
    expect(after.tinHash).toBe(hashTin('444-555-666'));
    const cert = await prisma.taxCertificate.findUniqueOrThrow({ where: { id: certificate.id } });
    expect(decryptField(cert.workerTin)).toBe('444-555-666');
    const secret = await prisma.mfaSecret.findUniqueOrThrow({ where: { userId: admin.id } });
    expect(decrypt(secret.secretEncrypted)).toBe('JBSWY3DPEHPK3PXP');

    // Re-running changes nothing.
    expect(runScript()).toMatch(/worker profiles 0, payouts 0, tax certificates 0/);
  }, 60_000);

  it('writes nothing if any value decrypts with neither key', async () => {
    useKeys({ data: OLD_DATA });
    const { user: readable } = await createTestUser('rotation-readable', { role: 'WORKER' });
    const { user: stranger } = await createTestUser('rotation-unknown-key', { role: 'WORKER' });
    createdUserIds.push(readable.id, stranger.id);
    const readableValue = encryptField('09170000001');
    await prisma.workerProfile.update({ where: { userId: readable.id }, data: { payoutAccountNumber: readableValue } });
    useKeys({ data: 'z'.repeat(64) }); // a key the script is never given
    await prisma.workerProfile.update({ where: { userId: stranger.id }, data: { payoutAccountNumber: encryptField('09170000002') } });

    const output = runScriptExpectingFailure();
    expect(output).toMatch(/decrypt with neither key — nothing was written/);
    expect(output).toContain(`WorkerProfile`);
    const after = await prisma.workerProfile.findUniqueOrThrow({ where: { userId: readable.id } });
    expect(after.payoutAccountNumber).toBe(readableValue);

    await prisma.workerProfile.update({ where: { userId: stranger.id }, data: { payoutAccountNumber: null } });
  }, 60_000);

  it('reports two workers who ended up with the same TIN under different keys', async () => {
    useKeys({ data: OLD_DATA });
    const { user: oldKeyWorker } = await createTestUser('rotation-dup-old', { role: 'WORKER' });
    createdUserIds.push(oldKeyWorker.id);
    await prisma.workerProfile.update({
      where: { userId: oldKeyWorker.id },
      data: { tin: encryptField('777-888-999'), tinHash: hashTin('777-888-999') },
    });
    useKeys({ data: NEW_DATA });
    const { user: newKeyWorker } = await createTestUser('rotation-dup-new', { role: 'WORKER' });
    createdUserIds.push(newKeyWorker.id);
    await prisma.workerProfile.update({
      where: { userId: newKeyWorker.id },
      data: { tin: encryptField('777-888-999'), tinHash: hashTin('777-888-999') },
    });

    const output = runScriptExpectingFailure();
    expect(output).toMatch(/share a TIN with another worker/);

    // Clean up so later runs aren't blocked by this pair.
    await prisma.workerProfile.updateMany({
      where: { userId: { in: [oldKeyWorker.id, newKeyWorker.id] } },
      data: { tin: null, tinHash: null },
    });
  }, 60_000);
});
