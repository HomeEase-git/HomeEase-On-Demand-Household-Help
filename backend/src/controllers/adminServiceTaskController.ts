import { Request, Response } from 'express';
import { Prisma, TaskPricingModel } from '@prisma/client';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { writeAuditLog } from '@utils/auditLog';
import { checkDoleFloor } from '@services/pricingRuleService';
import { getHighestDoleWageReference } from '@/constants/doleWageReference';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

// Two ways to price a job: a flat price, or a price per piece the client
// counts. TIERED (worker price steps) and CUSTOM_QUOTE (worker quotes on site)
// are retired; extras and parts go on the worker's invoice instead.
const VALID_PRICING_MODELS: TaskPricingModel[] = ['FIXED', 'PER_UNIT'];

const taskInclude = {
  quantityScopeField: { select: { id: true, label: true } },
};

export type TaskInputBody = {
  name?: string;
  description?: string | null;
  basePrice?: number;
  pricingModel?: string;
  unitLabel?: string | null;
  quantityScopeFieldId?: string | null;
  durationHours?: number | null;
  isActive?: boolean;
  // Inspection/diagnosis job — the client can ask for a follow-up job after it.
  allowsFollowUp?: boolean;
  overrideReason?: string;
};

/**
 * The admin's price (basePrice) is what every client pays and every worker
 * earns — FIXED: the flat price, PER_UNIT: the price per piece. A switched-off
 * job may have no price yet (former custom-quote jobs); it needs one before
 * it can be switched back on.
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
  if (body.allowsFollowUp !== undefined && typeof body.allowsFollowUp !== 'boolean') {
    return 'allowsFollowUp must be true or false.';
  }

  if (body.isActive !== false && body.basePrice <= 0) {
    return 'Price must be above ₱0.';
  }

  if (body.pricingModel === 'PER_UNIT') {
    if (!body.unitLabel?.trim()) {
      return 'unitLabel is required for a per-unit task (e.g. "kilo", "sq.m.").';
    }
    if (!body.quantityScopeFieldId || !existingNumberFieldIds.has(body.quantityScopeFieldId)) {
      return 'quantityScopeFieldId must reference a NUMBER-type field on this service category.';
    }
  } else if (body.quantityScopeFieldId) {
    return 'quantityScopeFieldId only applies to per-unit tasks.';
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

    // Minimum-wage guardrail on the admin price — applies platform-wide (no
    // per-city variant), so it's checked against the highest region-wide
    // DOLE floor since there's no city here to look up.
    const doleCheck = checkDoleFloor(getHighestDoleWageReference(), body.basePrice!, body.overrideReason);
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
        minPrice: null,
        maxPrice: null,
        // Display-only for FIXED (the matrix's "per visit").
        unitLabel: body.unitLabel?.trim() || null,
        quantityScopeFieldId:
          body.pricingModel === 'PER_UNIT' ? body.quantityScopeFieldId! : null,
        durationHours: body.durationHours ?? null,
        allowsFollowUp: body.allowsFollowUp ?? false,
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
      metadata: { taskId: task.id, serviceTypeId, price: task.basePrice },
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

    if (body.isActive !== undefined && typeof body.isActive !== 'boolean') {
      return res.status(400).json(errorResponse(400, 'isActive must be a boolean.'));
    }
    const isActive = body.isActive ?? existing.isActive;

    const numberFieldIds = await getNumberFieldIds(serviceTypeId);
    const validationError = validateTaskInput({ ...body, isActive }, numberFieldIds);
    if (validationError) {
      return res.status(400).json(errorResponse(400, validationError));
    }

    const doleCheck = isActive
      ? checkDoleFloor(getHighestDoleWageReference(), body.basePrice!, body.overrideReason)
      : ({ blocked: false, note: null } as const);
    if (doleCheck.blocked) {
      return res.status(400).json(errorResponse(400, doleCheck.message));
    }

    const task = await prisma.$transaction(async (tx) => {
      return tx.serviceTask.update({
        where: { id: taskId },
        data: {
          name: body.name!.trim(),
          description: body.description?.trim() || null,
          basePrice: body.basePrice!,
          pricingModel: body.pricingModel as TaskPricingModel,
          minPrice: null,
          maxPrice: null,
          // Display-only for FIXED (the matrix's "per visit").
          unitLabel: body.unitLabel?.trim() || null,
          quantityScopeFieldId:
            body.pricingModel === 'PER_UNIT' ? body.quantityScopeFieldId! : null,
          durationHours: body.durationHours ?? null,
          isActive,
          ...(body.allowsFollowUp !== undefined ? { allowsFollowUp: body.allowsFollowUp } : {}),
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
      metadata: { taskId: task.id, serviceTypeId, price: task.basePrice },
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
    // A former custom-quote job has no price; it needs one before clients can book it.
    if (isActive && !(existing.basePrice > 0)) {
      return res.status(400).json(errorResponse(400, 'Give this job a price before switching it on.'));
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
