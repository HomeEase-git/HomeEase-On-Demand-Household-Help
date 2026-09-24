// Turns a category from prisma/seeds/data/jobOrderMatrix.json into the
// payload the admin editor's catalog save takes (see
// adminCatalogController.writeCatalog). Shared by seed-catalog.ts (fresh
// databases) and scripts/applyJobMatrix.ts (live categories).
import fs from 'fs';
import path from 'path';
import type { ServiceTask } from '@prisma/client';
import type { CatalogBody } from '../../../src/controllers/adminCatalogController';

export type MatrixQuestion = {
  label: string;
  helpText?: string;
  fieldType: 'TEXT' | 'NUMBER' | 'SELECT' | 'MULTI_SELECT';
  required: boolean;
  options?: string[];
  minValue?: number;
  maxValue?: number;
  usedForMatching?: boolean;
  setsPrice?: boolean;
};
export type MatrixJob = {
  name: string;
  unit: string;
  pricingModel: 'FIXED' | 'PER_UNIT' | 'CUSTOM_QUOTE';
  price?: number;
  replaces?: string;
  questions: MatrixQuestion[];
};
export type MatrixCategory = { name: string; commonQuestions: MatrixQuestion[]; jobs: MatrixJob[] };

export function loadMatrix(): MatrixCategory[] {
  const file = path.join(__dirname, '..', 'data', 'jobOrderMatrix.json');
  return (JSON.parse(fs.readFileSync(file, 'utf8')) as { categories: MatrixCategory[] }).categories;
}

/** Worker price range around the standard price: 80%–150%. */
export const matrixBounds = (price: number) => ({ minPrice: Math.round(price * 0.8), maxPrice: Math.round(price * 1.5) });

/** The category tile's starting price: its cheapest priced job. */
export const matrixStartingPrice = (matrix: MatrixCategory) =>
  Math.min(...matrix.jobs.filter((j) => j.pricingModel !== 'CUSTOM_QUOTE').map((j) => j.price!));

/**
 * Builds the catalog save for `matrix`. A live job named in a row's
 * `replaces` keeps its id (renamed in place); live jobs with no row are kept
 * but switched off. `jobRef(i)` gives the ref of the i-th matrix job, for
 * looking up its real id in writeCatalog's taskIdByRef afterwards.
 */
export function buildMatrixPayload(
  matrix: MatrixCategory,
  category: { name: string; description: string | null; icon: string | null; requiresCertification: boolean },
  liveTasks: ServiceTask[] = []
) {
  const liveByName = new Map(liveTasks.map((t) => [t.name, t]));
  const warnings: string[] = [];
  let keySeq = 0;
  const qKey = () => `q:${++keySeq}`;
  const fieldPayload = (q: MatrixQuestion, taskRefs: string[], key: string) => ({
    key,
    label: q.label,
    helpText: q.helpText ?? null,
    fieldType: q.fieldType,
    required: q.required,
    options: q.options ?? [],
    minValue: q.minValue ?? null,
    maxValue: q.maxValue ?? null,
    usedForMatching: !!q.usedForMatching,
    taskRefs,
  });

  const tasks: NonNullable<CatalogBody['tasks']> = [];
  const scopeFields: NonNullable<CatalogBody['scopeFields']> = matrix.commonQuestions.map((q) => fieldPayload(q, [], qKey()));
  const usedLive = new Set<string>();
  const liveFor: (ServiceTask | undefined)[] = [];

  for (const [i, job] of matrix.jobs.entries()) {
    const live = job.replaces ? liveByName.get(job.replaces) : undefined;
    if (job.replaces && liveTasks.length && !live) warnings.push(`"${job.replaces}" isn't live; "${job.name}" is created as a new job instead.`);
    if (live) usedLive.add(live.id);
    liveFor.push(live);
    const ref = live?.id ?? `job:${i}`;
    let quantityFieldRef: string | null = null;
    for (const q of job.questions) {
      const key = qKey();
      if (q.setsPrice) quantityFieldRef = key;
      scopeFields.push(fieldPayload(q, [ref], key));
    }
    const quote = job.pricingModel === 'CUSTOM_QUOTE';
    tasks.push({
      ...(live ? { id: live.id } : { key: ref }),
      name: job.name,
      description: live?.description ?? null,
      basePrice: quote ? 0 : job.price!,
      pricingModel: job.pricingModel,
      ...(quote ? { minPrice: null, maxPrice: null } : matrixBounds(job.price!)),
      unitLabel: job.unit,
      quantityFieldRef: job.pricingModel === 'PER_UNIT' ? quantityFieldRef : null,
      durationHours: quote ? null : live?.durationHours ?? null,
      isActive: true,
    });
  }

  // Live jobs with no row stay (bookings point at them) but are switched off.
  const unmatched = liveTasks.filter((t) => !usedLive.has(t.id));
  for (const live of unmatched) {
    tasks.push({
      id: live.id,
      name: live.name,
      description: live.description,
      basePrice: live.basePrice,
      pricingModel: live.pricingModel,
      minPrice: live.minPrice,
      maxPrice: live.maxPrice,
      unitLabel: live.unitLabel,
      quantityFieldRef: null,
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
    scopeFields,
  };
  return { body, warnings, unmatched, liveFor, jobRef: (i: number) => liveFor[i]?.id ?? `job:${i}` };
}

/**
 * Upper bound for a category's city price cap (PricingRule.maxPrice): its
 * most expensive possible booking at the top worker tier, plus 25% headroom
 * for the distance fee and worker packages, rounded up to the next ₱1,000.
 */
export function matrixCapMax(matrix: MatrixCategory, topTierMultiplier: number): number {
  const largestJob = Math.max(
    ...matrix.jobs
      .filter((j) => j.pricingModel !== 'CUSTOM_QUOTE')
      .map((j) => {
        const max = matrixBounds(j.price!).maxPrice;
        if (j.pricingModel !== 'PER_UNIT') return max;
        return max * (j.questions.find((q) => q.setsPrice)?.maxValue ?? 1);
      })
  );
  return Math.ceil((largestJob * topTierMultiplier * 1.25) / 1000) * 1000;
}
