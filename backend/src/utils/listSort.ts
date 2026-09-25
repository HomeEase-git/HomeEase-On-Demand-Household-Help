import type { Request } from 'express';

export type SortDir = 'asc' | 'desc';

/**
 * Reads ?sortBy=&sortDir= for an admin list. Only keys in `columns` are
 * accepted (anything else falls back to `fallback`), so a request can never
 * sort by an arbitrary or unindexed field. Each column maps a direction to a
 * Prisma orderBy (O = that model's OrderByWithRelationInput); a createdAt
 * tie-breaker keeps pages stable when many rows share a value (e.g. the same
 * client name).
 */
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
