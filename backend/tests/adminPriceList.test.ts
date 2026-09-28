import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { getHighestDoleWageReference } from '@/constants/doleWageReference';
import { createTestUser, deleteTestUser } from './helpers';

// The Price List edits only prices — every job's and every category's
// starting price — in one all-or-nothing save.
describe('Admin price list', () => {
  const createdUserIds: string[] = [];
  let adminToken: string;
  let clientToken: string;
  let serviceTypeId: string;
  let fixedId: string;
  let perUnitId: string;
  let quoteId: string;

  beforeAll(async () => {
    const admin = await createTestUser('pricelist-admin', { role: 'ADMIN' });
    const client = await createTestUser('pricelist-client', { role: 'CLIENT' });
    createdUserIds.push(admin.user.id, client.user.id);
    const adminLogin = await request(app).post('/api/auth/login').send({ email: admin.user.email, password: admin.plainPassword });
    adminToken = adminLogin.body.data.token;
    const clientLogin = await request(app).post('/api/auth/login').send({ email: client.user.email, password: client.plainPassword });
    clientToken = clientLogin.body.data.token;

    const serviceType = await prisma.serviceType.create({
      data: {
        name: `E2E Price List ${Date.now()}`,
        basePrice: 500,
        tasks: {
          create: [
            { name: 'Flat job', basePrice: 800, pricingModel: 'FIXED', sortOrder: 0 },
            { name: 'Per-unit job', basePrice: 300, pricingModel: 'PER_UNIT', unitLabel: 'unit', sortOrder: 1 },
            { name: 'Quote job', basePrice: 0, pricingModel: 'CUSTOM_QUOTE', sortOrder: 2 },
          ],
        },
      },
      include: { tasks: true },
    });
    serviceTypeId = serviceType.id;
    fixedId = serviceType.tasks.find((t) => t.name === 'Flat job')!.id;
    perUnitId = serviceType.tasks.find((t) => t.name === 'Per-unit job')!.id;
    quoteId = serviceType.tasks.find((t) => t.name === 'Quote job')!.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { action: 'PRICE_LIST_UPDATED', actorId: { in: createdUserIds } } });
    await prisma.serviceType.deleteMany({ where: { id: serviceTypeId } });
    for (const id of createdUserIds) await deleteTestUser(id);
    await prisma.$disconnect();
  });

  const save = (body: object, token = adminToken) =>
    request(app).patch('/api/admin/price-list').set('Authorization', `Bearer ${token}`).send(body);

  const priceOf = async (taskId: string) => (await prisma.serviceTask.findUniqueOrThrow({ where: { id: taskId } })).basePrice;

  it('lists every category with its jobs and the DOLE floor', async () => {
    const res = await request(app).get('/api/admin/price-list').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const category = res.body.data.categories.find((c: { id: string }) => c.id === serviceTypeId);
    expect(category.basePrice).toBe(500);
    expect(category.tasks.map((t: { name: string }) => t.name)).toEqual(['Flat job', 'Per-unit job', 'Quote job']);
    expect(res.body.data.doleFloor.hourlyWage).toBe(getHighestDoleWageReference().hourlyWage);
  });

  it('is admin-only', async () => {
    const res = await save({ tasks: [{ id: fixedId, basePrice: 900 }] }, clientToken);
    expect(res.status).toBe(403);
    expect(await priceOf(fixedId)).toBe(800);
  });

  it('saves job and starting prices together and logs from/to', async () => {
    const res = await save({
      tasks: [
        { id: fixedId, basePrice: 880 },
        { id: perUnitId, basePrice: 330.004 },
      ],
      categories: [{ id: serviceTypeId, basePrice: 330 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ updatedTasks: 2, updatedCategories: 1 });
    expect(await priceOf(fixedId)).toBe(880);
    expect(await priceOf(perUnitId)).toBe(330);
    expect((await prisma.serviceType.findUniqueOrThrow({ where: { id: serviceTypeId } })).basePrice).toBe(330);

    const log = await prisma.auditLog.findFirst({
      where: { action: 'PRICE_LIST_UPDATED', actorId: createdUserIds[0] },
      orderBy: { createdAt: 'desc' },
    });
    const meta = log!.metadata as { tasks: { taskId: string; from: number; to: number }[] };
    expect(meta.tasks).toContainEqual(expect.objectContaining({ taskId: fixedId, from: 800, to: 880 }));
  });

  it('rejects a custom-quote job and changes nothing', async () => {
    const res = await save({ tasks: [{ id: fixedId, basePrice: 999 }, { id: quoteId, basePrice: 500 }] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/custom-quote/);
    expect(await priceOf(fixedId)).toBe(880);
  });

  it('rejects zero, negative, duplicate and unknown entries', async () => {
    expect((await save({ tasks: [{ id: fixedId, basePrice: 0 }] })).status).toBe(400);
    expect((await save({ categories: [{ id: serviceTypeId, basePrice: -1 }] })).status).toBe(400);
    expect((await save({ tasks: [{ id: fixedId, basePrice: 900 }, { id: fixedId, basePrice: 901 }] })).status).toBe(400);
    expect((await save({ tasks: [{ id: 'does-not-exist', basePrice: 900 }] })).status).toBe(404);
    expect((await save({})).status).toBe(400);
    expect(await priceOf(fixedId)).toBe(880);
  });

  it('blocks prices below the DOLE hourly floor unless a reason is given', async () => {
    const below = Math.floor(getHighestDoleWageReference().hourlyWage) - 1;
    const blocked = await save({ tasks: [{ id: fixedId, basePrice: below }] });
    expect(blocked.status).toBe(400);
    expect(blocked.body.code).toBe('BELOW_DOLE_FLOOR');
    expect(await priceOf(fixedId)).toBe(880);

    const allowed = await save({ tasks: [{ id: fixedId, basePrice: below }], overrideReason: 'Promo add-on job' });
    expect(allowed.status).toBe(200);
    expect(await priceOf(fixedId)).toBe(below);
  });
});
