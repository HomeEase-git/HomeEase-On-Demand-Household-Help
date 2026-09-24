import { Request, Response } from 'express';
import { Prisma, TaskPricingModel } from '@prisma/client';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { writeAuditLog } from '@utils/auditLog';
import { checkDoleFloor } from '@services/pricingRuleService';
import { carryWorkerPricesAcrossModelChange } from '@services/taskPriceService';
import { getHighestDoleWageReference } from '@/constants/doleWageReference';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

const VALID_PRICING_MODELS: TaskPricingModel[] = ['FIXED', 'PER_UNIT', 'TIERED', 'CUSTOM_QUOTE'];

const taskInclude = {
  quantityScopeField: { select: { id: true, label: true } },
};

export type TaskInputBody = {
  name?: string;
  description?: string | null;
  basePrice?: number;
  pricingModel?: string;
  minPrice?: number | null;
  maxPrice?: number | null;
  unitLabel?: string | null;
  quantityScopeFieldId?: string | null;
  durationHours?: number | null;
  isActive?: boolean;
  overrideReason?: string;
};

/**
 * FIXED/PER_UNIT both need an admin-bounded range a worker's WorkerTaskPrice
 * must fall inside; CUSTOM_QUOTE has no upfront price at all (worker quotes
 * on-site via submitQuote), so it must NOT carry a range/unit/quantity field.
 */
export function validateTaskInput(body: TaskInputBody, existingNumberFieldIds: Set<string>): string | null {
  if (!body.name?.trim()) {
    return 'Name is required.';
  }
  if (typeof body.basePrice !== 'number' || Number.isNaN(body.basePrice) || body.basePrice < 0) {
    return 'Base price must be a non-negative number.';
  }
  if (!body.pricingModel || !VALID_PRICING_MODELS.includes(body.pricingModel as TaskPricingModel)) {
    return `pricingModel must be one of ${VALID_PRICING_MODELS.join(', ')}.`;
  }
  if (body.durationHours != null && (typeof body.durationHours !== 'number' || body.durationHours <= 0)) {
    return 'durationHours must be a positive number when provided.';
  }

  if (body.pricingModel === 'CUSTOM_QUOTE') {
    if (body.minPrice != null || body.maxPrice != null) {
      return 'Custom-quote tasks cannot have a price range — the worker quotes on-site.';
    }
    if (body.quantityScopeFieldId) {
      return 'Custom-quote tasks cannot have a quantity field.';
    }
    return null;
  }

  if (
    typeof body.minPrice !== 'number' ||
    typeof body.maxPrice !== 'number' ||
    Number.isNaN(body.minPrice) ||
    Number.isNaN(body.maxPrice) ||
    body.minPrice < 0 ||
    body.minPrice > body.maxPrice
  ) {
    return 'minPrice and maxPrice are required and minPrice must be <= maxPrice.';
  }

  if (body.pricingModel === 'PER_UNIT' || body.pricingModel === 'TIERED') {
    if (!body.unitLabel?.trim()) {
      return 'unitLabel is required for a per-unit or tiered task (e.g. "kilo", "sq.m.").';
    }
    if (!body.quantityScopeFieldId || !existingNumberFieldIds.has(body.quantityScopeFieldId)) {
      return 'quantityScopeFieldId must reference a NUMBER-type field on this service category.';
    }
  } else if (body.quantityScopeFieldId) {
    return 'quantityScopeFieldId only applies to per-unit or tiered tasks.';
  }

  return null;
}

async function getNumberFieldIds(serviceTypeId: string): Promise<Set<string>> {
  const fields = await prisma.serviceScopeField.findMany({
    where: { serviceTypeId, fieldType: 'NUMBER' },
    select: { id: true },
  });
  return new Set(fields.map((f) => f.id));
}

export const listTasksForServiceType = async (req: Request, res: Response) => {
  try {
    const serviceTypeId = req.params.serviceTypeId as string;
    const tasks = await prisma.serviceTask.findMany({
      where: { serviceTypeId },
      include: taskInclude,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return res.json({ success: true, data: tasks });
  } catch (error) {
    console.error('List service tasks error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const createTask = async (req: AuthRequest, res: Response) => {
  try {
    const serviceTypeId = req.params.serviceTypeId as string;
    const body = req.body as TaskInputBody;

    const serviceType = await prisma.serviceType.findUnique({ where: { id: serviceTypeId } });
    if (!serviceType) {
      return res.status(404).json(errorResponse(404, 'Service type not found'));
    }

    const numberFieldIds = await getNumberFieldIds(serviceTypeId);
    const validationError = validateTaskInput(body, numberFieldIds);
    if (validationError) {
      return res.status(400).json(errorResponse(400, validationError));
    }

    const isCustomQuote = body.pricingModel === 'CUSTOM_QUOTE';

    // ServiceTask.minPrice/maxPrice is the bound a worker's own
    // WorkerTaskPrice must fall inside (see taskPriceService) — unlike
    // PricingRule, it applies platform-wide with no per-city variant, so
    // this was the actual race-to-the-bottom guard the DOLE-floor check was
    // built for, just never wired to it (only the separate city/service
    // PricingRule admin screen had it). Checked against the highest
    // region-wide floor since there's no city here to look up.
    const doleCheck = isCustomQuote
      ? ({ blocked: false, note: null } as const)
      : checkDoleFloor(getHighestDoleWageReference(), body.minPrice!, body.overrideReason);
    if (doleCheck.blocked) {
      return res.status(400).json(errorResponse(400, doleCheck.message));
    }

    const task = await prisma.serviceTask.create({
      data: {
        serviceTypeId,
        name: body.name!.trim(),
        description: body.description?.trim() || null,
        basePrice: body.basePrice!,
        pricingModel: body.pricingModel as TaskPricingModel,
        minPrice: isCustomQuote ? null : body.minPrice!,
        maxPrice: isCustomQuote ? null : body.maxPrice!,
        // Display-only for FIXED/CUSTOM_QUOTE (the matrix's "per visit").
        unitLabel: body.unitLabel?.trim() || null,
        quantityScopeFieldId:
          body.pricingModel === 'PER_UNIT' || body.pricingModel === 'TIERED' ? body.quantityScopeFieldId! : null,
        durationHours: isCustomQuote ? null : body.durationHours ?? null,
      },
      include: taskInclude,
    });

    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'TASK_CREATED',
      category: 'ADMIN_ACTION',
      level: doleCheck.note ? 'WARN' : 'INFO',
      message: doleCheck.note ?? `Task created: ${task.name} (${serviceType.name})`,
      metadata: { taskId: task.id, serviceTypeId, minPrice: task.minPrice, maxPrice: task.maxPrice },
    });

    return res.status(201).json({ success: true, data: task });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json(errorResponse(409, 'A task with this name already exists in this category.'));
    }
    console.error('Create task error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const updateTask = async (req: AuthRequest, res: Response) => {
  try {
    const { serviceTypeId, taskId } = req.params as { serviceTypeId: string; taskId: string };
    const body = req.body as TaskInputBody;

    const existing = await prisma.serviceTask.findFirst({ where: { id: taskId, serviceTypeId } });
    if (!existing) {
      return res.status(404).json(errorResponse(404, 'Task not found'));
    }

    const numberFieldIds = await getNumberFieldIds(serviceTypeId);
    const validationError = validateTaskInput(body, numberFieldIds);
    if (validationError) {
      return res.status(400).json(errorResponse(400, validationError));
    }
    if (body.isActive !== undefined && typeof body.isActive !== 'boolean') {
      return res.status(400).json(errorResponse(400, 'isActive must be a boolean.'));
    }

    const isCustomQuote = body.pricingModel === 'CUSTOM_QUOTE';

    const doleCheck = isCustomQuote
      ? ({ blocked: false, note: null } as const)
      : checkDoleFloor(getHighestDoleWageReference(), body.minPrice!, body.overrideReason);
    if (doleCheck.blocked) {
      return res.status(400).json(errorResponse(400, doleCheck.message));
    }

    // Price change + model change together, so a FIXED<->PER_UNIT switch
    // never leaves workers with only the value the new model doesn't read.
    const task = await prisma.$transaction(async (tx) => {
      await carryWorkerPricesAcrossModelChange(tx, taskId, existing.pricingModel, body.pricingModel!);
      return tx.serviceTask.update({
        where: { id: taskId },
        data: {
          name: body.name!.trim(),
          description: body.description?.trim() || null,
          basePrice: body.basePrice!,
          pricingModel: body.pricingModel as TaskPricingModel,
          minPrice: isCustomQuote ? null : body.minPrice!,
          maxPrice: isCustomQuote ? null : body.maxPrice!,
          // Display-only for FIXED/CUSTOM_QUOTE (the matrix's "per visit").
          unitLabel: body.unitLabel?.trim() || null,
          quantityScopeFieldId:
            body.pricingModel === 'PER_UNIT' || body.pricingModel === 'TIERED' ? body.quantityScopeFieldId! : null,
          durationHours: isCustomQuote ? null : body.durationHours ?? null,
          isActive: body.isActive ?? existing.isActive,
        },
        include: taskInclude,
      });
    });

    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'TASK_UPDATED',
      category: 'ADMIN_ACTION',
      level: doleCheck.note ? 'WARN' : 'INFO',
      message: doleCheck.note ?? `Task updated: ${task.name}`,
      metadata: { taskId: task.id, serviceTypeId, minPrice: task.minPrice, maxPrice: task.maxPrice },
    });

    return res.json({ success: true, data: task });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json(errorResponse(409, 'A task with this name already exists in this category.'));
    }
    console.error('Update task error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const toggleTaskActive = async (req: AuthRequest, res: Response) => {
  try {
    const { serviceTypeId, taskId } = req.params as { serviceTypeId: string; taskId: string };
    const { isActive } = req.body as { isActive?: boolean };

    if (typeof isActive !== 'boolean') {
      return res.status(400).json(errorResponse(400, 'isActive must be a boolean.'));
    }

    const existing = await prisma.serviceTask.findFirst({ where: { id: taskId, serviceTypeId } });
    if (!existing) {
      return res.status(404).json(errorResponse(404, 'Task not found'));
    }

    const task = await prisma.serviceTask.update({
      where: { id: taskId },
      data: { isActive },
      include: taskInclude,
    });

    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: isActive ? 'TASK_ACTIVATED' : 'TASK_DEACTIVATED',
      category: 'ADMIN_ACTION',
      message: `Task ${isActive ? 'activated' : 'deactivated'}: ${task.name}`,
    });

    return res.json({ success: true, data: task });
  } catch (error) {
    console.error('Toggle task active error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};
