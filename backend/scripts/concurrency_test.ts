import prisma from '../src/config/database';

async function attempt(name: string, workerId: string, clientId: string, dateStr: string, timeStr: string) {
  try {
    const result = await prisma.$transaction(async (tx: any) => {
      const existing = await tx.booking.findFirst({
        where: {
          workerId,
          scheduledDate: new Date(dateStr),
          scheduledTime: timeStr,
        },
      });
      if (existing) throw new Error('Slot already taken (pre-check)');

      const created = await tx.booking.create({
        data: {
          clientId,
          workerId,
          serviceType: 'TEST',
          description: `Test booking ${name}`,
          location: 'Test Addr',
          city: 'TestCity',
          scheduledDate: new Date(dateStr),
          scheduledTime: timeStr,
          estimatedPrice: 100,
          status: 'PENDING',
        },
      });
      return created;
    });
    console.log(`${name} created booking`, result.id);
  } catch (e: any) {
    console.error(`${name} failed:`, e.message || e.code || e);
  }
}

async function main() {
  const workerId = process.env.TEST_WORKER_ID || 'w1';
  const clientId = process.env.TEST_CLIENT_ID || 'test-client';
  const dateStr = process.env.TEST_DATE || new Date(Date.now() + 1000 * 60 * 60 * 24 * 3).toISOString().split('T')[0];
  const timeStr = process.env.TEST_TIME || '09:00';

  console.log('Running concurrency test for', workerId, dateStr, timeStr);

  await Promise.all([
    attempt('A', workerId, clientId, dateStr, timeStr),
    attempt('B', workerId, clientId, dateStr, timeStr),
  ]);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
