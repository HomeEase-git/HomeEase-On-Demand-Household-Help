import { Request, Response } from 'express';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { writeAuditLog } from '@utils/auditLog';
import { checkDoleFloor } from '@services/pricingRuleService';
import { getHighestDoleWageReference } from '@/constants/doleWageReference';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

// Price List: every category's starting price and every job's price on one
// screen, saved together. Only prices change here — names, pricing models,
// questions and everything else still go through the job order editor
// (adminCatalogController), which stays the one place a job is defined.

type PriceChange = { id?: unknown; basePrice?: unknown };
type PriceListBody = {
  tasks?: PriceChange[];
  categories?: PriceChange[];
  overrideReason?: string;
};

// One bulk "+10% on everything" over the whole matrix is ~150 rows; this
// leaves headroom without letting one request rewrite unbounded rows.
const MAX_CHANGES = 1000;

export const getPriceList = async (_req: Request, res: Response) => {
  try {
    const categories = await prisma.serviceType.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        basePrice: true,
        isActive: true,
        tasks: {
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: { id: true, name: true, basePrice: true, pricingModel: true, unitLabel: true, isActive: true },
        },
      },
    });
    const dole = getHighestDoleWageReference();
    return res.json({
      success: true,
      data: {
        categories,
        doleFloor: { hourlyWage: dole.hourlyWage, label: dole.label, wageOrder: dole.wageOrder },
      },
    });
  } catch (error) {
    console.error('Get price list error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

function parseChanges(list: PriceChange[] | undefined, what: string, minExclusive: boolean) {
  if (list === undefined) return { changes: [] as { id: string; basePrice: number }[] };
  if (!Array.isArray(list)) return { error: `${what} must be a list.` };
  const seen = new Set<string>();
  const changes: { id: string; basePrice: number }[] = [];
  for (const item of list) {
    if (typeof item?.id !== 'string' || !item.id) return { error: `Every ${what} change needs an id.` };
    if (seen.has(item.id)) return { error: `The same ${what} is listed twice.` };
    seen.add(item.id);
    const price = item.basePrice;
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || (minExclusive && price === 0)) {
      return { error: `Every ${what} price must be ${minExclusive ? 'above ₱0' : '₱0 or more'}.` };
    }
    changes.push({ id: item.id, basePrice: Math.round(price * 100) / 100 });
  }
  return { changes };
}

export const updatePriceList = async (req: AuthRequest, res: Response) => {
  try {
    const body = (req.body ?? {}) as PriceListBody;
    const taskParse = parseChanges(body.tasks, 'job', true);
    if ('error' in taskParse) return res.status(400).json(errorResponse(400, taskParse.error!));
    const categoryParse = parseChanges(body.categories, 'category', false);
    if ('error' in categoryParse) return res.status(400).json(errorResponse(400, categoryParse.error!));

    const taskChanges = taskParse.changes;
    const categoryChanges = categoryParse.changes;
    if (!taskChanges.length && !categoryChanges.length) {
      return res.status(400).json(errorResponse(400, 'No price changes to save.'));
    }
    if (taskChanges.length + categoryChanges.length > MAX_CHANGES) {
      return res.status(400).json(errorResponse(400, `Save at most ${MAX_CHANGES} price changes at a time.`));
    }

    const [tasks, categories] = await Promise.all([
      prisma.serviceTask.findMany({
        where: { id: { in: taskChanges.map((c) => c.id) } },
        select: { id: true, name: true, basePrice: true, pricingModel: true, serviceType: { select: { name: true } } },
      }),
      prisma.serviceType.findMany({
        where: { id: { in: categoryChanges.map((c) => c.id) } },
        select: { id: true, name: true, basePrice: true },
      }),
    ]);
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    if (taskById.size !== taskChanges.length || categoryById.size !== categoryChanges.length) {
      return res.status(404).json(errorResponse(404, 'Some of these jobs or categories no longer exist. Reload the Price List.'));
    }

    // Custom-quote jobs have no upfront price (the worker quotes on site), so
    // there's nothing here to set.
    const quoteJob = taskChanges.map((c) => taskById.get(c.id)!).find((t) => t.pricingModel === 'CUSTOM_QUOTE');
    if (quoteJob) {
      return res.status(400).json(errorResponse(400, `"${quoteJob.name}" is a custom-quote job and has no set price.`));
    }

    // Same minimum-wage guardrail as the job order editor. One reason covers
    // every below-floor job in the save, since a bulk change is one decision.
    const dole = getHighestDoleWageReference();
    const belowFloor: string[] = [];
    for (const change of taskChanges) {
      const check = checkDoleFloor(dole, change.basePrice, body.overrideReason);
      if (check.blocked) {
        belowFloor.push(taskById.get(change.id)!.name);
      }
    }
    if (belowFloor.length) {
      const names = belowFloor.slice(0, 5).map((n) => `"${n}"`).join(', ');
      const more = belowFloor.length > 5 ? ` and ${belowFloor.length - 5} more` : '';
      return res.status(400).json({
        ...errorResponse(
          400,
          `${names}${more} would be below the DOLE ${dole.label} hourly wage floor (₱${dole.hourlyWage}/hr, ${dole.wageOrder}). Give a reason to save anyway.`
        ),
        code: 'BELOW_DOLE_FLOOR',
      });
    }

    await prisma.$transaction([
      ...taskChanges.map((c) => prisma.serviceTask.update({ where: { id: c.id }, data: { basePrice: c.basePrice } })),
      ...categoryChanges.map((c) => prisma.serviceType.update({ where: { id: c.id }, data: { basePrice: c.basePrice } })),
    ]);

    const taskLog = taskChanges.map((c) => {
      const t = taskById.get(c.id)!;
      return { taskId: c.id, name: `${t.serviceType.name} · ${t.name}`, from: t.basePrice, to: c.basePrice };
    });
    const categoryLog = categoryChanges.map((c) => {
      const cat = categoryById.get(c.id)!;
      return { serviceTypeId: c.id, name: cat.name, from: cat.basePrice, to: c.basePrice };
    });
    const anyBelowFloor = taskChanges.some((c) => c.basePrice < dole.hourlyWage);
    const reason = body.overrideReason?.trim();
    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'PRICE_LIST_UPDATED',
      category: 'ADMIN_ACTION',
      level: anyBelowFloor ? 'WARN' : 'INFO',
      message:
        `Price List saved: ${taskChanges.length} job price(s), ${categoryChanges.length} starting price(s)` +
        (anyBelowFloor ? ` — some below the DOLE ${dole.label} floor (₱${dole.hourlyWage}/hr), reason: ${reason}` : '') +
        (!anyBelowFloor && reason ? ` — note: ${reason}` : ''),
      metadata: { tasks: taskLog, categories: categoryLog },
    });

    return res.json({
      success: true,
      data: { updatedTasks: taskChanges.length, updatedCategories: categoryChanges.length },
    });
  } catch (error) {
    console.error('Update price list error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};
