import prisma from '@config/database';
import { clearStaleWorkerLocations } from '@workers/bookingWorker';
import { createTestBooking, createTestUser, deleteTestUser } from './helpers';

describe('clearStaleWorkerLocations', () => {
  const userIds: string[] = [];

  afterAll(async () => {
    for (const id of userIds) await deleteTestUser(id);
  });

  async function workerWithLocation(label: string, lastLocationUpdate: Date) {
    const { user } = await createTestUser(label, { role: 'WORKER' });
    userIds.push(user.id);
    await prisma.workerProfile.update({
      where: { userId: user.id },
      data: { currentLat: 14.6, currentLng: 121.0, lastLocationUpdate },
    });
    return user;
  }

  async function locationOf(userId: string) {
    return prisma.workerProfile.findUnique({
      where: { userId },
      select: { currentLat: true, currentLng: true, lastLocationUpdate: true },
    });
  }

  it('keeps a fresh location for a worker travelling to an ACCEPTED booking', async () => {
    const { user: client } = await createTestUser('loc-client', { role: 'CLIENT' });
    userIds.push(client.id);
    const worker = await workerWithLocation('loc-en-route', new Date());
    await createTestBooking({ clientId: client.id, workerId: worker.id, status: 'ACCEPTED' });

    await clearStaleWorkerLocations();

    expect((await locationOf(worker.id))?.currentLat).toBe(14.6);
  });

  it('clears the location of a worker with no booking in progress', async () => {
    const worker = await workerWithLocation('loc-idle', new Date());

    await clearStaleWorkerLocations();

    expect(await locationOf(worker.id)).toEqual({ currentLat: null, currentLng: null, lastLocationUpdate: null });
  });

  it('clears a location not updated for over two hours even while en route', async () => {
    const { user: client } = await createTestUser('loc-client-2', { role: 'CLIENT' });
    userIds.push(client.id);
    const worker = await workerWithLocation('loc-stale', new Date(Date.now() - 3 * 60 * 60 * 1000));
    await createTestBooking({ clientId: client.id, workerId: worker.id, status: 'ACCEPTED' });

    await clearStaleWorkerLocations();

    expect((await locationOf(worker.id))?.currentLat).toBeNull();
  });
});
