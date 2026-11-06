import type { Request } from 'express';

export type SortDir = 'asc' | 'desc';

export function parseListSort<O>(
  query: Request['query'],
  columns: Record<string, (dir: SortDir) => O>,
  fallback: { key: string; dir: SortDir },
): { sortBy: string; sortDir: SortDir; orderBy: O[] } {
  const requested = typeof query.sortBy === 'string' ? query.sortBy : '';
  const known = Object.prototype.hasOwnProperty.call(columns, requested);
  const sortBy = known ? requested : fallback.key;
  const sortDir: SortDir =
    known && (query.sortDir === 'asc' || query.sortDir === 'desc') ? query.sortDir : known ? 'asc' : fallback.dir;
  return { sortBy, sortDir, orderBy: [columns[sortBy](sortDir), { createdAt: 'desc' } as O] };
}
