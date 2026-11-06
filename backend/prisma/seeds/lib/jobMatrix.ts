import fs from 'fs';
import path from 'path';
import type { ServiceTask } from '@prisma/client';
import type { CatalogBody } from '../../../src/controllers/adminCatalogController';

export type MatrixJob = {
  name: string;
  unit: string;
  pricingModel: 'FIXED' | 'PER_UNIT';
  price: number;
  replaces?: string;
  minQuantity?: number;
  maxQuantity?: number;
};
export type MatrixCategory = { name: string; jobs: MatrixJob[] };

export function loadMatrix(): MatrixCategory[] {
  const file = path.join(__dirname, '..', 'data', 'jobOrderMatrix.json');
  return (JSON.parse(fs.readFileSync(file, 'utf8')) as { categories: MatrixCategory[] }).categories;
}

export const matrixBounds = (price: number) => ({ minPrice: Math.round(price * 0.8), maxPrice: Math.round(price * 1.5) });

export const matrixStartingPrice = (matrix: MatrixCategory) =>
  Math.min(...matrix.jobs.map((j) => j.price));

export function buildMatrixPayload(
  matrix: MatrixCategory,
  category: { name: string; description: string | null; icon: string | null; requiresCertification: boolean },
  liveTasks: ServiceTask[] = []
) {
  const liveByName = new Map(liveTasks.map((t) => [t.name, t]));
  const warnings: string[] = [];
  const tasks: NonNullable<CatalogBody['tasks']> = [];
  const usedLive = new Set<string>();
  const liveFor: (ServiceTask | undefined)[] = [];

  for (const [i, job] of matrix.jobs.entries()) {
    const live = job.replaces ? liveByName.get(job.replaces) : undefined;
    if (job.replaces && liveTasks.length && !live) warnings.push(`"${job.replaces}" isn't live; "${job.name}" is created as a new job instead.`);
    if (live) usedLive.add(live.id);
    liveFor.push(live);
    const ref = live?.id ?? `job:${i}`;
    tasks.push({
      ...(live ? { id: live.id } : { key: ref }),
      name: job.name,
      description: live?.description ?? null,
      basePrice: job.price,
      pricingModel: job.pricingModel,
      unitLabel: job.unit,
      minQuantity: job.pricingModel === 'PER_UNIT' ? (job.minQuantity ?? null) : null,
      maxQuantity: job.pricingModel === 'PER_UNIT' ? (job.maxQuantity ?? null) : null,
      durationHours: live?.durationHours ?? null,
      isActive: true,
    });
  }

  const unmatched = liveTasks.filter((t) => !usedLive.has(t.id));
  for (const live of unmatched) {
    tasks.push({
      id: live.id,
      name: live.name,
      description: live.description,
      basePrice: live.basePrice,
      pricingModel: live.pricingModel,
      unitLabel: live.unitLabel,
      minQuantity: live.minQuantity,
      maxQuantity: live.maxQuantity,
      durationHours: live.durationHours,
      isActive: false,
    });
  }

  const body: CatalogBody = {
    name: category.name,
    description: category.description,
    basePrice: matrixStartingPrice(matrix),
    icon: category.icon,
    requiresCertification: category.requiresCertification,
    tasks,
  };
  return { body, warnings, unmatched, liveFor, jobRef: (i: number) => liveFor[i]?.id ?? `job:${i}` };
}
