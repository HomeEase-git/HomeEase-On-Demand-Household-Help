import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { buildCapabilityFilters } from '@services/matchingService';
import { createTestUser, deleteTestUser } from './helpers';

// The job order editor saves a whole category — details, jobs and each job's
// own booking questions — in one request, with new jobs/questions referenced
// by temporary keys until they have ids.
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

  const newCatalog = () => ({
    name: `E2E Aircon ${Date.now()}`,
    description: 'Aircon cleaning and repair',
    basePrice: 350,
    tasks: [
      job('t-diag', 'Diagnosis Fee', { basePrice: 350 }),
      job('t-split', 'Aircon Cleaning – Split Type', {
        basePrice: 1500,
        pricingModel: 'PER_UNIT',
        unitLabel: 'unit',
        quantityFieldRef: 'f-units',
      }),
      job('t-window', 'Aircon Cleaning – Window Type', {
        pricingModel: 'PER_UNIT',
        unitLabel: 'unit',
        quantityFieldRef: 'f-units-window',
      }),
    ],
    scopeFields: [
      { key: 'f-brand', label: 'Brand', fieldType: 'TEXT', required: false, taskRefs: [] },
      {
        key: 'f-symptom',
        label: 'Symptom',
        fieldType: 'SELECT',
        options: ['Not cooling', 'Leaking'],
        taskRefs: ['t-diag'],
      },
      { key: 'f-units', label: 'How many units?', fieldType: 'NUMBER', minValue: 1, maxValue: 10, taskRefs: ['t-split'] },
      {
        key: 'f-hp',
        label: 'HP',
        helpText: 'Check the sticker on the indoor unit.',
        fieldType: 'SELECT',
        options: ['1 HP', '1.5 HP', '2 HP+'],
        taskRefs: ['t-split'],
      },
      // Same text as the split-type count, on a different job — allowed.
      { key: 'f-units-window', label: 'How many units?', fieldType: 'NUMBER', minValue: 1, maxValue: 10, taskRefs: ['t-window'] },
    ],
  });

  const create = (body: object) =>
    request(app).post('/api/admin/service-types/catalog').set('Authorization', `Bearer ${adminToken}`).send(body);
  const update = (id: string, body: object) =>
    request(app).put(`/api/admin/service-types/${id}/catalog`).set('Authorization', `Bearer ${adminToken}`).send(body);

  it('creates a category with its jobs, per-job questions and count questions in one save', async () => {
    const res = await create(newCatalog());
    expect(res.status).toBe(201);
    const cat = res.body.data;
    createdServiceTypeIds.push(cat.id);

    expect(cat.tasks.map((t: { name: string }) => t.name)).toEqual([
      'Diagnosis Fee',
      'Aircon Cleaning – Split Type',
      'Aircon Cleaning – Window Type',
    ]);
    const split = cat.tasks[1];
    const window = cat.tasks[2];
    const byLabelAndJob = (label: string, taskId?: string) =>
      cat.scopeFields.find(
        (f: { label: string; taskLinks: { serviceTaskId: string }[] }) =>
          f.label === label && (taskId ? f.taskLinks.some((l) => l.serviceTaskId === taskId) : f.taskLinks.length === 0)
      );

    expect(byLabelAndJob('Brand')).toBeDefined();
    expect(byLabelAndJob('Symptom', cat.tasks[0].id)).toBeDefined();
    expect(byLabelAndJob('HP', split.id).helpText).toBe('Check the sticker on the indoor unit.');
    expect(split.quantityScopeFieldId).toBe(byLabelAndJob('How many units?', split.id).id);
    expect(window.quantityScopeFieldId).toBe(byLabelAndJob('How many units?', window.id).id);
    expect(split.quantityScopeFieldId).not.toBe(window.quantityScopeFieldId);
  });

  it('updates in place: keeps ids, moves a question between jobs, deletes a removed one, adds a new job', async () => {
    const created = (await create(newCatalog())).body.data;
    createdServiceTypeIds.push(created.id);
    const [diag, split, window] = created.tasks;
    const field = (label: string) => created.scopeFields.find((f: { label: string }) => f.label === label);
    const splitUnits = created.scopeFields.find((f: { id: string }) => f.id === split.quantityScopeFieldId);
    const windowUnits = created.scopeFields.find((f: { id: string }) => f.id === window.quantityScopeFieldId);
    const hpOptionIds = field('HP').options.map((o: { id: string }) => o.id);

    const res = await update(created.id, {
      name: created.name,
      basePrice: 350,
      tasks: [
        { id: diag.id, name: diag.name, basePrice: 350, pricingModel: 'FIXED', isActive: false },
        {
          id: split.id,
          name: split.name,
          basePrice: 1500,
          pricingModel: 'PER_UNIT',
          unitLabel: 'unit',
          quantityFieldRef: splitUnits.id,
        },
        {
          id: window.id,
          name: window.name,
          basePrice: 800,
          pricingModel: 'PER_UNIT',
          unitLabel: 'unit',
          quantityFieldRef: windowUnits.id,
        },
        job('t-new', 'Freon Recharge', { basePrice: 1800 }),
      ],
      scopeFields: [
        // Symptom dropped; HP now asked for both cleaning jobs, text reworded.
        { id: field('Brand').id, label: 'Brand', fieldType: 'TEXT', required: false, taskRefs: [] },
        { id: splitUnits.id, label: 'How many units?', fieldType: 'NUMBER', minValue: 1, maxValue: 10, taskRefs: [split.id] },
        { id: windowUnits.id, label: 'How many units?', fieldType: 'NUMBER', minValue: 1, maxValue: 10, taskRefs: [window.id] },
        {
          id: field('HP').id,
          label: 'Horsepower (HP)',
          fieldType: 'SELECT',
          options: ['1 HP', '1.5 HP', '2 HP+'],
          taskRefs: [split.id, window.id],
        },
        { key: 'f-refrigerant', label: 'Refrigerant', fieldType: 'SELECT', options: ['R22', 'R410A', 'R32'], taskRefs: ['t-new'] },
      ],
    });
    expect(res.status).toBe(200);
    const saved = res.body.data;

    const hp = saved.scopeFields.find((f: { id: string }) => f.id === field('HP').id);
    expect(hp.label).toBe('Horsepower (HP)');
    expect(hp.options.map((o: { id: string }) => o.id)).toEqual(hpOptionIds);
    expect(hp.taskLinks.map((l: { serviceTaskId: string }) => l.serviceTaskId).sort()).toEqual([split.id, window.id].sort());
    expect(saved.scopeFields.some((f: { label: string }) => f.label === 'Symptom')).toBe(false);

    const freon = saved.tasks.find((t: { name: string }) => t.name === 'Freon Recharge');
    const refrigerant = saved.scopeFields.find((f: { label: string }) => f.label === 'Refrigerant');
    expect(refrigerant.taskLinks).toEqual([{ serviceTaskId: freon.id }]);
    expect(saved.tasks.find((t: { id: string }) => t.id === diag.id).isActive).toBe(false);
    expect(saved.tasks.find((t: { id: string }) => t.id === split.id).quantityScopeFieldId).toBe(splitUnits.id);
  });

  it('rejects two questions with the same text on the same job', async () => {
    const body = newCatalog();
    body.scopeFields.push({ key: 'f-dup', label: 'hp', fieldType: 'TEXT', taskRefs: ['t-split'] } as never);
    const res = await create(body);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Aircon Cleaning – Split Type/);
  });

  it('rejects a common question whose text a job question repeats', async () => {
    const body = newCatalog();
    body.scopeFields.push({ key: 'f-dup', label: 'Symptom', fieldType: 'TEXT', taskRefs: [] } as never);
    expect((await create(body)).status).toBe(400);
  });

  it('rejects a per-unit job without a count question', async () => {
    const body = newCatalog();
    body.tasks[1] = { ...body.tasks[1], quantityFieldRef: undefined } as never;
    const res = await create(body);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/count question/);
  });

  it("rejects ids from another category, so a save can't reach outside it", async () => {
    const a = (await create(newCatalog())).body.data;
    createdServiceTypeIds.push(a.id);
    const body = newCatalog();
    const res = await create({ ...body, tasks: [{ ...body.tasks[0], key: undefined, id: a.tasks[0].id }, ...body.tasks.slice(1)] });
    expect(res.status).toBe(400);
  });

  it('only narrows workers by a matching question asked for the booked job', async () => {
    const body = newCatalog();
    body.scopeFields.push(
      { key: 'f-brand-diag', label: 'Unit brand', fieldType: 'SELECT', options: ['Carrier', 'Koppel'], usedForMatching: true, taskRefs: ['t-diag'] } as never,
      { key: 'f-brand-split', label: 'Unit brand', fieldType: 'SELECT', options: ['Carrier', 'Koppel'], usedForMatching: true, taskRefs: ['t-split'] } as never
    );
    const cat = (await create(body)).body.data;
    createdServiceTypeIds.push(cat.id);
    const answers = { 'Unit brand': 'Carrier' };

    expect(await buildCapabilityFilters(cat.name, answers)).toHaveLength(2);
    expect(await buildCapabilityFilters(cat.name, answers, cat.tasks[0].id)).toHaveLength(1);
    expect(await buildCapabilityFilters(cat.name, answers, cat.tasks[2].id)).toHaveLength(0);
  });

  it("stores one admin price per job and no worker price range", async () => {
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

