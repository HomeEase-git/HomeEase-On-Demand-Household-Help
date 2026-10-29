import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { createTestUser, deleteTestUser } from './helpers';

// The job order editor saves a whole category — details and jobs — in one
// request, with new jobs referenced by temporary keys until they have ids.
describe('Admin service catalog save', () => {
  const createdUserIds: string[] = [];
  const createdServiceTypeIds: string[] = [];
  let adminToken: string;

  beforeAll(async () => {
    const { user, plainPassword } = await createTestUser('catalog-admin', { role: 'ADMIN' });
    createdUserIds.push(user.id);
    const login = await request(app).post('/api/auth/login').send({ email: user.email, password: plainPassword });
    adminToken = login.body.data.token;
  });

  afterAll(async () => {
    await prisma.serviceType.deleteMany({ where: { id: { in: createdServiceTypeIds } } });
    for (const id of createdUserIds) await deleteTestUser(id);
    await prisma.$disconnect();
  });

  const job = (key: string, name: string, extra: Record<string, unknown> = {}) => ({
    key,
    name,
    basePrice: 800,
    pricingModel: 'FIXED',
    ...extra,
  });

  const newCatalog = (): { name: string; description: string; basePrice: number; tasks: Record<string, unknown>[] } => ({
    name: `E2E Aircon ${Date.now()}`,
    description: 'Aircon cleaning and repair',
    basePrice: 350,
    tasks: [
      job('t-diag', 'Diagnosis Fee', { basePrice: 350 }),
      job('t-split', 'Aircon Cleaning – Split Type', {
        basePrice: 1500,
        pricingModel: 'PER_UNIT',
        unitLabel: 'unit',
        maxQuantity: 10,
      }),
      job('t-wall', 'Wall Painting', {
        basePrice: 100,
        pricingModel: 'PER_UNIT',
        unitLabel: 'sq.m.',
        minQuantity: 10,
        maxQuantity: 1000,
      }),
    ],
  });

  const create = (body: object) =>
    request(app).post('/api/admin/service-types/catalog').set('Authorization', `Bearer ${adminToken}`).send(body);
  const update = (id: string, body: object) =>
    request(app).put(`/api/admin/service-types/${id}/catalog`).set('Authorization', `Bearer ${adminToken}`).send(body);

  it('creates a category with its jobs and per-unit count limits in one save', async () => {
    const res = await create(newCatalog());
    expect(res.status).toBe(201);
    const cat = res.body.data;
    createdServiceTypeIds.push(cat.id);

    expect(cat.tasks.map((t: { name: string }) => t.name)).toEqual([
      'Diagnosis Fee',
      'Aircon Cleaning – Split Type',
      'Wall Painting',
    ]);
    expect(cat.tasks[0]).toMatchObject({ minQuantity: null, maxQuantity: null });
    expect(cat.tasks[1]).toMatchObject({ minQuantity: null, maxQuantity: 10 });
    expect(cat.tasks[2]).toMatchObject({ minQuantity: 10, maxQuantity: 1000 });
    expect(cat).not.toHaveProperty('scopeFields');
  });

  it('updates in place: keeps ids, deactivates a job, adds a new job', async () => {
    const created = (await create(newCatalog())).body.data;
    createdServiceTypeIds.push(created.id);
    const [diag, split, wall] = created.tasks;

    const res = await update(created.id, {
      name: created.name,
      basePrice: 350,
      tasks: [
        { id: diag.id, name: diag.name, basePrice: 350, pricingModel: 'FIXED', isActive: false },
        { id: split.id, name: split.name, basePrice: 1500, pricingModel: 'PER_UNIT', unitLabel: 'unit', maxQuantity: 5 },
        { id: wall.id, name: wall.name, basePrice: 100, pricingModel: 'PER_UNIT', unitLabel: 'sq.m.' },
        job('t-new', 'Freon Recharge', { basePrice: 1800 }),
      ],
    });
    expect(res.status).toBe(200);
    const saved = res.body.data;

    expect(saved.tasks.find((t: { id: string }) => t.id === diag.id).isActive).toBe(false);
    expect(saved.tasks.find((t: { id: string }) => t.id === split.id).maxQuantity).toBe(5);
    expect(saved.tasks.find((t: { id: string }) => t.id === wall.id)).toMatchObject({ minQuantity: null, maxQuantity: null });
    expect(saved.tasks.some((t: { name: string }) => t.name === 'Freon Recharge')).toBe(true);
  });

  it('rejects a count limit below 1, since the count sets the price', async () => {
    const body = newCatalog();
    body.tasks[1] = { ...body.tasks[1], minQuantity: 0 };
    const res = await create(body);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/minQuantity must be a number of at least 1/);
  });

  it('rejects a minimum above the maximum', async () => {
    const body = newCatalog();
    body.tasks[2] = { ...body.tasks[2], minQuantity: 2000 };
    const res = await create(body);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/minQuantity cannot be more than maxQuantity/);
  });

  it('rejects count limits on a flat-priced job', async () => {
    const body = newCatalog();
    body.tasks[0] = { ...body.tasks[0], maxQuantity: 3 };
    expect((await create(body)).status).toBe(400);
  });

  it("rejects ids from another category, so a save can't reach outside it", async () => {
    const a = (await create(newCatalog())).body.data;
    createdServiceTypeIds.push(a.id);
    const body = newCatalog();
    const res = await create({ ...body, tasks: [{ ...body.tasks[0], key: undefined, id: a.tasks[0].id }, ...body.tasks.slice(1)] });
    expect(res.status).toBe(400);
  });

  it('stores one admin price per job and no worker price range', async () => {
    const cat = (await create(newCatalog())).body.data;
    createdServiceTypeIds.push(cat.id);
    const diag = cat.tasks.find((t: { name: string }) => t.name === 'Diagnosis Fee');
    expect(diag.basePrice).toBe(350);
    expect(diag.minPrice).toBeNull();
    expect(diag.maxPrice).toBeNull();
  });

  it('rejects the retired worker-price-steps model', async () => {
    const body = newCatalog();
    body.tasks[1] = { ...body.tasks[1], pricingModel: 'TIERED' };
    const res = await create(body);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/pricingModel/);
  });
});
