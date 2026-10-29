import { Request, Response } from 'express';
import { Prisma, TaskPricingModel } from '@prisma/client';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { writeAuditLog } from '@utils/auditLog';
import { VALID_SERVICE_ICONS } from '@/constants/serviceIcons';
import { checkDoleFloor } from '@services/pricingRuleService';
import { getHighestDoleWageReference } from '@/constants/doleWageReference';
import { serviceTypeInclude } from './adminServiceTypeController';
import { validateTaskInput, type TaskInputBody } from './adminServiceTaskController';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

/**
 * The admin's job-order editor saves a whole category in one request: its
 * details and every job (ServiceTask). New jobs don't have ids yet, so the
 * client gives each one a temporary `key` ('ref'). Everything is written in
 * one transaction, so a failed save never leaves a half-built category behind.
 *
 * Jobs are never deleted here (past bookings point at them) — the editor
 * deactivates them instead. A job left out of the payload is left alone.
 * Booking questions are retired; a category's old question rows are left
 * untouched.
 */

type CatalogTaskInput = TaskInputBody & {
  id?: string;
  key?: string;
};

export type CatalogBody = {
  name?: string;
  description?: string | null;
  basePrice?: number;
  icon?: string | null;
  backgroundImageUrl?: string | null;
  requiresCertification?: boolean;
  tasks?: CatalogTaskInput[];
};

const refOf = (item: { id?: string; key?: string }) => item.id ?? item.key ?? '';

export function validateCatalog(body: CatalogBody, existingTaskIds: Set<string>): string | null {
  if (!body.name?.trim()) return 'Name is required.';
  if (typeof body.basePrice !== 'number' || Number.isNaN(body.basePrice) || body.basePrice < 0) {
    return 'Starting price must be a non-negative number.';
  }
  if (body.icon != null && !VALID_SERVICE_ICONS.includes(body.icon as (typeof VALID_SERVICE_ICONS)[number])) {
    return `icon must be one of the curated set: ${VALID_SERVICE_ICONS.join(', ')}.`;
  }
  if (body.backgroundImageUrl != null && (typeof body.backgroundImageUrl !== 'string' || !/^https:\/\//.test(body.backgroundImageUrl))) {
    return 'backgroundImageUrl must be an https URL.';
  }
  if (body.requiresCertification !== undefined && typeof body.requiresCertification !== 'boolean') {
    return 'requiresCertification must be a boolean.';
  }
  if (!Array.isArray(body.tasks)) {
    return 'tasks must be a list.';
  }

  const refs = new Set<string>();
  for (const task of body.tasks) {
    if (task.id !== undefined && !existingTaskIds.has(task.id)) return "A job in this save doesn't belong to this category.";
    if (task.id === undefined && (typeof task.key !== 'string' || !task.key)) return 'Every new job needs a key.';
    const ref = refOf(task);
    if (refs.has(ref)) return `Two items in this save share the reference "${ref}".`;
    refs.add(ref);
    const taskError = validateTaskInput(task);
    if (taskError) return `Job "${task.name?.trim() || 'Untitled'}": ${taskError}`;
    if (task.isActive !== undefined && typeof task.isActive !== 'boolean') {
      return `Job "${task.name?.trim()}": isActive must be a boolean.`;
    }
  }

  return null;
}

function taskData(task: CatalogTaskInput, sortOrder: number) {
  return {
    name: task.name!.trim(),
    description: task.description?.trim() || null,
    sortOrder,
    basePrice: task.basePrice!,
    pricingModel: task.pricingModel as TaskPricingModel,
    // Retired worker price range — see ServiceTask.minPrice.
    minPrice: null,
    maxPrice: null,
    // Display-only for FIXED (the matrix's "per visit").
    unitLabel: task.unitLabel?.trim() || null,
    minQuantity: task.pricingModel === 'PER_UNIT' ? (task.minQuantity ?? null) : null,
    maxQuantity: task.pricingModel === 'PER_UNIT' ? (task.maxQuantity ?? null) : null,
    durationHours: task.durationHours ?? null,
    // Omitted by the job-matrix script, which mustn't reset it.
    ...(task.allowsFollowUp !== undefined ? { allowsFollowUp: task.allowsFollowUp } : {}),
  };
}

/**
 * Writes a validated catalog save inside the caller's transaction and returns
 * the category id plus the real id of every job (by ref). Shared
 * by the admin endpoint and scripts/applyJobMatrix.ts, so a scripted rollout
 * writes exactly what the editor would.
 */
export async function writeCatalog(
  tx: Prisma.TransactionClient,
  existing: { id: string; tasks: { id: string; pricingModel: TaskPricingModel }[] } | null,
  body: CatalogBody
): Promise<{ categoryId: string; taskIdByRef: Map<string, string> }> {
  const tasks = body.tasks!;
  const categoryData = {
    name: body.name!.trim(),
    description: body.description?.trim() || null,
    basePrice: body.basePrice!,
    icon: body.icon || null,
    // Undefined (scripts/seeds) leaves it unchanged; null clears it.
    ...(body.backgroundImageUrl !== undefined ? { backgroundImageUrl: body.backgroundImageUrl || null } : {}),
    requiresCertification: body.requiresCertification ?? false,
  };

  const category = existing
    ? await tx.serviceType.update({ where: { id: existing.id }, data: categoryData })
    : await tx.serviceType.create({ data: categoryData });

  const taskIdByRef = new Map<string, string>();
  for (const [index, task] of tasks.entries()) {
    if (task.id) {
      await tx.serviceTask.update({
        where: { id: task.id },
        data: { ...taskData(task, index), ...(task.isActive !== undefined && { isActive: task.isActive }) },
      });
      taskIdByRef.set(task.id, task.id);
    } else {
      const created = await tx.serviceTask.create({
        data: { serviceTypeId: category.id, ...taskData(task, index), isActive: task.isActive ?? true },
      });
      taskIdByRef.set(task.key!, created.id);
    }
  }

  return { categoryId: category.id, taskIdByRef };
}

async function saveCatalog(req: AuthRequest, res: Response, serviceTypeId: string | null) {
  const body = req.body as CatalogBody;

  const existing = serviceTypeId
    ? await prisma.serviceType.findUnique({
        where: { id: serviceTypeId },
        include: { tasks: { select: { id: true, pricingModel: true } } },
      })
    : null;
  if (serviceTypeId && !existing) {
    return res.status(404).json(errorResponse(404, 'Service type not found'));
  }

  const validationError = validateCatalog(body, new Set(existing?.tasks.map((t) => t.id) ?? []));
  if (validationError) {
    return res.status(400).json(errorResponse(400, validationError));
  }

  const tasks = body.tasks!;

  // Same minimum-wage guardrail as the single-job save (adminServiceTaskController).
  const doleNotes: string[] = [];
  for (const task of tasks) {
    if (task.isActive === false) continue;
    const check = checkDoleFloor(getHighestDoleWageReference(), task.basePrice!, task.overrideReason);
    if (check.blocked) {
      return res.status(400).json(errorResponse(400, `Job "${task.name!.trim()}": ${check.message}`));
    }
    if (check.note) doleNotes.push(`${task.name!.trim()}: ${check.note}`);
  }

  const record = await prisma.$transaction(
    async (tx) => {
      const { categoryId } = await writeCatalog(tx, existing, body);
      return tx.serviceType.findUniqueOrThrow({ where: { id: categoryId }, include: serviceTypeInclude });
    },
    // A full category is a few hundred small writes; the 5s default is too
    // tight for a remote database.
    { timeout: 60_000, maxWait: 10_000 }
  );

  await writeAuditLog({
    actorId: req.user?.userId,
    actorName: req.user?.email,
    actorRole: req.user?.role,
    action: existing ? 'SERVICE_TYPE_UPDATED' : 'SERVICE_TYPE_CREATED',
    category: 'ADMIN_ACTION',
    level: doleNotes.length ? 'WARN' : 'INFO',
    message: `Service catalog ${existing ? 'updated' : 'created'}: ${record.name} (${tasks.length} jobs)${
      doleNotes.length ? ` — ${doleNotes.join('; ')}` : ''
    }`,
    metadata: { serviceTypeId: record.id },
  });

  return res.status(existing ? 200 : 201).json({ success: true, data: record });
}

function handleError(res: Response, error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return res.status(409).json(errorResponse(409, 'Another service already has this name.'));
  }
  console.error('Save service catalog error:', error);
  return res.status(500).json(errorResponse(500, 'Internal server error'));
}

export const createServiceCatalog = async (req: AuthRequest, res: Response) => {
  try {
    return await saveCatalog(req, res, null);
  } catch (error) {
    return handleError(res, error);
  }
};

export const updateServiceCatalog = async (req: AuthRequest, res: Response) => {
  try {
    return await saveCatalog(req, res, req.params.id as string);
  } catch (error) {
    return handleError(res, error);
  }
};
