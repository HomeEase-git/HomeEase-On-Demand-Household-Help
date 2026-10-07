// Shape of the `pagination` block every paginated backend list returns.
export type Pagination = { page: number; limit: number; total: number; pages: number };

export const hasMorePages = (p?: Pagination | null) => !!p && p.page < p.pages;

// Offset pages shift when new rows arrive, so a later page can repeat rows
// already loaded. Keep only the ones not already in `existing`.
export function uniqueNew<T extends { id: string }>(incoming: T[], existing: T[]): T[] {
  const seen = new Set(existing.map((x) => x.id));
  return incoming.filter((x) => !seen.has(x.id));
}
