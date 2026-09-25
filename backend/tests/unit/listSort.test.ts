import { parseListSort } from '../../src/utils/listSort';

type OrderBy = Record<string, unknown>;
const columns: Record<string, (dir: 'asc' | 'desc') => OrderBy> = {
  date: (dir) => ({ scheduledDate: dir }),
  client: (dir) => ({ client: { fullName: dir } }),
};
const fallback = { key: 'date', dir: 'desc' as const };

describe('parseListSort', () => {
  it('uses the fallback when nothing is asked for', () => {
    expect(parseListSort({}, columns, fallback)).toEqual({
      sortBy: 'date',
      sortDir: 'desc',
      orderBy: [{ scheduledDate: 'desc' }, { createdAt: 'desc' }],
    });
  });

  it('sorts by an allowed column in the requested direction', () => {
    expect(parseListSort({ sortBy: 'client', sortDir: 'desc' }, columns, fallback).orderBy).toEqual([
      { client: { fullName: 'desc' } },
      { createdAt: 'desc' },
    ]);
  });

  it('defaults an allowed column to ascending', () => {
    expect(parseListSort({ sortBy: 'client' }, columns, fallback).sortDir).toBe('asc');
  });

  it.each(['password', '__proto__', 'constructor', 'toString'])('ignores a column that is not allowed: %s', (sortBy) => {
    expect(parseListSort({ sortBy, sortDir: 'asc' }, columns, fallback)).toMatchObject({ sortBy: 'date', sortDir: 'desc' });
  });

  it('ignores a bad direction', () => {
    expect(parseListSort({ sortBy: 'client', sortDir: 'sideways' }, columns, fallback).sortDir).toBe('asc');
  });
});
