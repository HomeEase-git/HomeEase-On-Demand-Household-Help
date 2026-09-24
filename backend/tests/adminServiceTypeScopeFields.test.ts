import request from 'supertest';
import app from '@/app';
import prisma from '@config/database';
import { createTestUser, deleteTestUser } from './helpers';

// Saving a category from the admin panel used to delete and recreate every
// scope field, silently unlinking a per-unit job's quantity field and wiping
// workers' capability choices. These cover the in-place sync that replaced it.
describe('Admin service type scope field sync', () => {
  const createdUserIds: string[] = [];
  let adminToken: string;
  let serviceTypeId: string;

  const basePayload = (scopeFields: unknown[]) => ({ basePrice: 500, scopeFields });

  beforeAll(async () => {
    const { user, plainPassword } = await createTestUser('scope-sync-admin', { role: 'ADMIN' });
    createdUserIds.push(user.id);
    const login = await request(app).post('/api/auth/login').send({ email: user.email, password: plainPassword });
    adminToken = login.body.data.token;

    const serviceType = await prisma.serviceType.create({
      data: {
        name: `E2E Scope Sync ${Date.now()}`,
        basePrice: 500,
        scopeFields: {
          create: [
            { label: 'Where is the problem?', fieldType: 'SELECT', sortOrder: 0, options: { create: [{ label: 'Kitchen' }, { label: 'Bathroom' }] } },
            { label: 'How many toilets?', fieldType: 'NUMBER', sortOrder: 1, minValue: 1, maxValue: 5 },
          ],
        },
      },
      include: { scopeFields: true },
    });
    serviceTypeId = serviceType.id;
    const countField = serviceType.scopeFields.find((f) => f.label === 'How many toilets?')!;
    await prisma.serviceTask.createMany({
      data: [
        {
          serviceTypeId,
          name: 'Toilet Declogging',
          basePrice: 1000,
          pricingModel: 'PER_UNIT',
          unitLabel: 'toilet',
          quantityScopeFieldId: countField.id,
          minPrice: 800,
          maxPrice: 1500,
        },
        { serviceTypeId, name: 'Leak Repair', basePrice: 800, minPrice: 640, maxPrice: 1200 },
      ],
    });
  });

  afterAll(async () => {
    if (serviceTypeId) await prisma.serviceType.delete({ where: { id: serviceTypeId } });
    for (const id of createdUserIds) await deleteTestUser(id);
    await prisma.$disconnect();
  });

  const fieldsNow = () =>
    prisma.serviceScopeField.findMany({
      where: { serviceTypeId },
      include: { options: true, taskLinks: true },
      orderBy: { sortOrder: 'asc' },
    });

  it('keeps field and option ids, and the per-unit quantity link, when saved without ids (current admin web)', async () => {
    const before = await fieldsNow();
    const kitchenOptionId = before[0].options.find((o) => o.label === 'Kitchen')!.id;
    const name = (await prisma.serviceType.findUnique({ where: { id: serviceTypeId } }))!.name;

    const res = await request(app)
      .patch(`/api/admin/service-types/${serviceTypeId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        ...basePayload([
          { label: 'Where is the problem?', fieldType: 'SELECT', options: ['Kitchen', 'Bathroom', 'Outdoor'] },
          { label: 'How many toilets?', fieldType: 'NUMBER', minValue: 1, maxValue: 5 },
        ]),
        name,
      });
    expect(res.status).toBe(200);

    const after = await fieldsNow();
    expect(after.map((f) => f.id)).toEqual(before.map((f) => f.id));
    expect(after[0].options.find((o) => o.label === 'Kitchen')!.id).toBe(kitchenOptionId);
    expect(after[0].options.map((o) => o.label).sort()).toEqual(['Bathroom', 'Kitchen', 'Outdoor']);

    const toiletJob = await prisma.serviceTask.findFirst({ where: { serviceTypeId, name: 'Toilet Declogging' } });
    expect(toiletJob!.quantityScopeFieldId).toBe(before[1].id);
  });

  it('sets, keeps and clears job links, and rejects links to jobs outside the category', async () => {
    const name = (await prisma.serviceType.findUnique({ where: { id: serviceTypeId } }))!.name;
    const leakJob = await prisma.serviceTask.findFirst({ where: { serviceTypeId, name: 'Leak Repair' } });
    const save = (scopeFields: unknown[]) =>
      request(app)
        .patch(`/api/admin/service-types/${serviceTypeId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...basePayload(scopeFields), name });

    const pipeField = { label: 'Pipe material', fieldType: 'SELECT', options: ['PVC', 'Copper'] };
    const areaField = { label: 'Where is the problem?', fieldType: 'SELECT', options: ['Kitchen', 'Bathroom', 'Outdoor'] };
    const countField = { label: 'How many toilets?', fieldType: 'NUMBER', minValue: 1, maxValue: 5 };

    expect((await save([areaField, countField, { ...pipeField, taskIds: [leakJob!.id] }])).status).toBe(200);
    let pipe = (await fieldsNow()).find((f) => f.label === 'Pipe material')!;
    expect(pipe.taskLinks.map((l) => l.serviceTaskId)).toEqual([leakJob!.id]);

    // taskIds omitted: links are kept.
    expect((await save([areaField, countField, pipeField])).status).toBe(200);
    pipe = (await fieldsNow()).find((f) => f.label === 'Pipe material')!;
    expect(pipe.taskLinks).toHaveLength(1);

    // taskIds: [] clears them (asked for every job again).
    expect((await save([areaField, countField, { ...pipeField, taskIds: [] }])).status).toBe(200);
    pipe = (await fieldsNow()).find((f) => f.label === 'Pipe material')!;
    expect(pipe.taskLinks).toHaveLength(0);

    const bad = await save([areaField, countField, { ...pipeField, taskIds: ['not-a-job-here'] }]);
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/isn't in this category/);
  });

  it('rejects two fields with the same label', async () => {
    const name = (await prisma.serviceType.findUnique({ where: { id: serviceTypeId } }))!.name;
    const res = await request(app)
      .patch(`/api/admin/service-types/${serviceTypeId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        ...basePayload([
          { label: 'Bedrooms', fieldType: 'NUMBER' },
          { label: 'bedrooms ', fieldType: 'NUMBER' },
        ]),
        name,
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/both labeled/);
  });

  it('deletes only the fields that were removed', async () => {
    const name = (await prisma.serviceType.findUnique({ where: { id: serviceTypeId } }))!.name;
    const before = await fieldsNow();
    const res = await request(app)
      .patch(`/api/admin/service-types/${serviceTypeId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        ...basePayload([{ label: 'How many toilets?', fieldType: 'NUMBER', minValue: 1, maxValue: 5 }]),
        name,
      });
    expect(res.status).toBe(200);
    const after = await fieldsNow();
    expect(after.map((f) => f.label)).toEqual(['How many toilets?']);
    expect(after[0].id).toBe(before.find((f) => f.label === 'How many toilets?')!.id);
  });
});
