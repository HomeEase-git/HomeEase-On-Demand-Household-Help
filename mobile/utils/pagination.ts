export type Pagination = { page: number; limit: number; total: number; pages: number };

export const hasMorePages = (p?: Pagination | null) => !!p && p.page < p.pages;

export function uniqueNew<T extends { id: string }>(incoming: T[], existing: T[]): T[] {
  const seen = new Set(existing.map((x) => x.id));
  return incoming.filter((x) => !seen.has(x.id));
}
