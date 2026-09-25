import type { Request, Response } from 'express';

const mockFindMany = jest.fn();
const mockCount = jest.fn();
const mockUpdate = jest.fn();
const mockTransaction = jest.fn();

jest.mock('@config/database', () => ({
  __esModule: true,
  default: {
    promoBanner: { findMany: mockFindMany, count: mockCount, update: mockUpdate },
    $transaction: mockTransaction,
  },
}));
jest.mock('@config/supabase', () => ({ supabase: { storage: { from: jest.fn() } }, PROMO_BANNER_BUCKET: 'promo-banners' }));
jest.mock('@utils/auditLog', () => ({ writeAuditLog: jest.fn() }));

import {
  validatePromoBannerInput,
  listActivePromoBanners,
  reorderPromoBanners,
} from '../../src/controllers/promoBannerController';

const IMG = 'https://example.supabase.co/storage/v1/object/public/promo-banners/a.jpg';

function mockRes() {
  const json = jest.fn();
  const res = { json, status: jest.fn(() => ({ json })) } as unknown as Response;
  return { res, json, status: res.status as jest.Mock };
}

describe('validatePromoBannerInput', () => {
  it('accepts a full banner and trims text', () => {
    const r = validatePromoBannerInput({ title: '  Rainy-day cleaning  ', subtitle: ' 10% off ', imageUrl: IMG });
    expect(r).toEqual({ data: { title: 'Rainy-day cleaning', subtitle: '10% off', imageUrl: IMG } });
  });

  it.each([
    [{ imageUrl: IMG }, 'Title is required.'],
    [{ title: 'x'.repeat(61), imageUrl: IMG }, 'Title must be 60 characters or less.'],
    [{ title: 'Hi' }, 'An uploaded image is required.'],
    [{ title: 'Hi', imageUrl: 'http://insecure.example/a.jpg' }, 'An uploaded image is required.'],
    [{ title: 'Hi', imageUrl: IMG, startsAt: 'not a date' }, 'startsAt is not a valid date.'],
    [{ title: 'Hi', imageUrl: IMG, startsAt: '2026-10-02', endsAt: '2026-10-01' }, 'The end date must be after the start date.'],
    [{ title: 'Hi', imageUrl: IMG, isActive: 'yes' }, 'isActive must be true or false.'],
  ])('rejects %o', (body, error) => {
    expect(validatePromoBannerInput(body)).toEqual({ error });
  });

  it('only checks sent fields on a partial update', () => {
    expect(validatePromoBannerInput({ isActive: false }, { partial: true })).toEqual({ data: { isActive: false } });
  });

  it('clears optional fields with null or empty', () => {
    const r = validatePromoBannerInput({ subtitle: '', linkServiceTypeId: null, endsAt: '' }, { partial: true });
    expect(r).toEqual({ data: { subtitle: null, linkServiceTypeId: null, endsAt: null } });
  });
});

describe('listActivePromoBanners', () => {
  it('asks only for active banners whose schedule includes now, in order', async () => {
    mockFindMany.mockResolvedValue([]);
    const { res } = mockRes();
    await listActivePromoBanners({} as Request, res);
    const args = mockFindMany.mock.calls[0][0];
    expect(args.where.isActive).toBe(true);
    expect(args.where.AND).toEqual([
      { OR: [{ startsAt: null }, { startsAt: { lte: expect.any(Date) } }] },
      { OR: [{ endsAt: null }, { endsAt: { gt: expect.any(Date) } }] },
    ]);
    expect(args.orderBy).toEqual([{ sortOrder: 'asc' }, { createdAt: 'asc' }]);
  });
});

describe('reorderPromoBanners', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([[undefined], [['a', 'a']], [['a', 5]]])('rejects ids=%o', async (ids) => {
    const { res, status } = mockRes();
    await reorderPromoBanners({ body: { ids } } as unknown as Request, res);
    expect(status).toHaveBeenCalledWith(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('rejects an id that does not exist', async () => {
    mockCount.mockResolvedValue(1);
    const { res, status } = mockRes();
    await reorderPromoBanners({ body: { ids: ['a', 'b'] } } as unknown as Request, res);
    expect(status).toHaveBeenCalledWith(400);
  });

  it('saves the list position as sortOrder', async () => {
    mockCount.mockResolvedValue(2);
    mockUpdate.mockImplementation((args) => args);
    mockTransaction.mockResolvedValue([]);
    const { res, json } = mockRes();
    await reorderPromoBanners({ body: { ids: ['b', 'a'] } } as unknown as Request, res);
    expect(mockUpdate).toHaveBeenNthCalledWith(1, { where: { id: 'b' }, data: { sortOrder: 0 } });
    expect(mockUpdate).toHaveBeenNthCalledWith(2, { where: { id: 'a' }, data: { sortOrder: 1 } });
    expect(json).toHaveBeenCalledWith({ success: true });
  });
});
