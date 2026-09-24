import { Request, Response } from 'express';
import { Prisma, ScopeFieldType, TaskPricingModel } from '@prisma/client';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { writeAuditLog } from '@utils/auditLog';
import { VALID_SERVICE_ICONS } from '@/constants/serviceIcons';
import { checkDoleFloor } from '@services/pricingRuleService';
import { getHighestDoleWageReference } from '@/constants/doleWageReference';
import {
  VALID_FIELD_TYPES,
  OPTION_FIELD_TYPES,
  serviceTypeInclude,
  scopeFieldData,
  cleanOptionLabels,
  syncFieldOptions,
  type ScopeFieldInput,
} from './adminServiceTypeController';
import { validateTaskInput, type TaskInputBody } from './adminServiceTaskController';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

/**
 * The admin's job-order editor saves a whole category in one request: its
 * details, every job (ServiceTask) and every booking question
 * (ServiceScopeField), with each question limited to the jobs it's asked for.
 * New jobs and questions don't have ids yet, so the client gives each one a
 * temporary `key`, and questions/quantity fields point at jobs/questions by
 * `id` or `key` ("ref"). Everything is written in one transaction, so a
 * failed save never leaves a half-built category behind.
 *
 * Jobs are never deleted here (past bookings point at them) — the editor
 * deactivates them instead. A job left out of the payload is left alone.
 * Questions left out are deleted, same as the older per-category save.
 */

type CatalogTaskInput = TaskInputBody & {
  id?: string;
  key?: string;
  // id or key of the NUMBER question that supplies a PER_UNIT/TIERED job's quantity.
  quantityFieldRef?: string | null;
};

type CatalogFieldInput = ScopeFieldInput & {
  key?: string;
  // ids or keys of the jobs this question is asked for. [] = every job.
  taskRefs?: string[];
};

type CatalogBody = {
  name?: string;
  description?: string | null;
  basePrice?: number;
  icon?: string | null;
  requiresCertification?: boolean;
  tasks?: CatalogTaskInput[];
  scopeFields?: CatalogFieldInput[];
};

const refOf = (item: { id?: string; key?: string }) => item.id ?? item.key ?? '';

function validateCatalog(
  body: CatalogBody,
  existingTaskIds: Set<string>,
  existingFieldIds: Set<string>
): string | null {
  if (!body.name?.trim()) return 'Name is required.';
  if (typeof body.basePrice !== 'number' || Number.isNaN(body.basePrice) || body.basePrice < 0) {
    return 'Starting price must be a non-negative number.';
  }
  if (body.icon != null && !VALID_SERVICE_ICONS.includes(body.icon as (typeof VALID_SERVICE_ICONS)[number])) {
    return `icon must be one of the curated set: ${VALID_SERVICE_ICONS.join(', ')}.`;
  }
  if (body.requiresCertification !== undefined && typeof body.requiresCertification !== 'boolean') {
    return 'requiresCertification must be a boolean.';
  }
  if (!Array.isArray(body.tasks) || !Array.isArray(body.scopeFields)) {
    return 'tasks and scopeFields must both be lists.';
  }

  const refs = new Set<string>();
  const claimRef = (item: { id?: string; key?: string }, what: string, existing: Set<string>): string | null => {
    if (item.id !== undefined && !existing.has(item.id)) return `A ${what} in this save doesn't belong to this category.`;
    if (item.id === undefined && (typeof item.key !== 'string' || !item.key)) return `Every new ${what} needs a key.`;
    const ref = refOf(item);
    if (refs.has(ref)) return `Two items in this save share the reference "${ref}".`;
    refs.add(ref);
    return null;
  };

  const fieldsByRef = new Map<string, CatalogFieldInput>();
  for (const field of body.scopeFields) {
    const refError = claimRef(field, 'question', existingFieldIds);
    if (refError) return refError;
    fieldsByRef.set(refOf(field), field);
    const label = field.label?.trim();
    if (!label) return 'Every question needs text.';
    if (!field.fieldType || !VALID_FIELD_TYPES.includes(field.fieldType as ScopeFieldType)) {
      return `Question "${label}" has an unknown answer type.`;
    }
    if (
      OPTION_FIELD_TYPES.includes(field.fieldType as ScopeFieldType) &&
      cleanOptionLabels(field).length === 0
    ) {
      return `Question "${label}" needs at least one choice.`;
    }
    if (field.usedForMatching && !OPTION_FIELD_TYPES.includes(field.fieldType as ScopeFieldType)) {
      return `Question "${label}" can only match workers if it's a Pick one or Pick any question.`;
    }
    if (
      field.fieldType === 'NUMBER' &&
      field.minValue != null &&
      field.maxValue != null &&
      field.minValue > field.maxValue
    ) {
      return `Question "${label}"'s minimum can't be greater than its maximum.`;
    }
    if (field.taskRefs !== undefined && (!Array.isArray(field.taskRefs) || !field.taskRefs.every((t) => typeof t === 'string'))) {
      return `Question "${label}" has an invalid job list.`;
    }
  }

  const taskRefs = new Set<string>();
  const numberFieldRefs = new Set(
    body.scopeFields.filter((f) => f.fieldType === 'NUMBER').map(refOf)
  );
  for (const task of body.tasks) {
    const refError = claimRef(task, 'job', existingTaskIds);
    if (refError) return refError;
    taskRefs.add(refOf(task));
    const taskError = validateTaskInput(
      { ...task, quantityScopeFieldId: task.quantityFieldRef ?? null },
      numberFieldRefs
    );
    if (taskError) return `Job "${task.name?.trim() || 'Untitled'}": ${taskError.replace('quantityScopeFieldId', 'the count question')}`;
    if (task.isActive !== undefined && typeof task.isActive !== 'boolean') {
      return `Job "${task.name?.trim()}": isActive must be a boolean.`;
    }
  }

  for (const field of body.scopeFields) {
    if ((field.taskRefs ?? []).some((r) => !taskRefs.has(r))) {
      return `Question "${field.label?.trim()}" is linked to a job that isn't in this category.`;
    }
  }

  // Booking answers are keyed by question text, so two questions a client
  // can see on the same job must not share it. Questions on different jobs
  // may (e.g. "How many units?" under several jobs).
  const labelKey = (f: CatalogFieldInput) => f.label!.trim().toLowerCase();
  const common = body.scopeFields.filter((f) => !f.taskRefs?.length);
  const groups: { name: string; fields: CatalogFieldInput[] }[] = [{ name: 'the common questions', fields: common }];
  for (const task of body.tasks) {
    const ref = refOf(task);
    groups.push({
      name: `"${task.name!.trim()}"`,
      fields: body.scopeFields.filter(
        (f) => !f.taskRefs?.length || f.taskRefs.includes(ref) || refOf(f) === task.quantityFieldRef
      ),
    });
  }
  for (const group of groups) {
    const seen = new Set<string>();
    for (const f of group.fields) {
      if (seen.has(labelKey(f))) {
        return `Two questions for ${group.name} both read "${f.label!.trim()}". Reword one of them.`;
      }
      seen.add(labelKey(f));
    }
  }

  return null;
}

function taskData(task: CatalogTaskInput, sortOrder: number) {
  const isCustomQuote = task.pricingModel === 'CUSTOM_QUOTE';
  return {
    name: task.name!.trim(),
    description: task.description?.trim() || null,
    sortOrder,
    basePrice: task.basePrice!,
    pricingModel: task.pricingModel as TaskPricingModel,
    minPrice: isCustomQuote ? null : task.minPrice!,
    maxPrice: isCustomQuote ? null : task.maxPrice!,
    // Display-only for FIXED/CUSTOM_QUOTE (the matrix's "per visit").
    unitLabel: task.unitLabel?.trim() || null,
    durationHours: isCustomQuote ? null : task.durationHours ?? null,
  };
}

async function saveCatalog(req: AuthRequest, res: Response, serviceTypeId: string | null) {
  const body = req.body as CatalogBody;

  const existing = serviceTypeId
    ? await prisma.serviceType.findUnique({
        where: { id: serviceTypeId },
        include: { tasks: { select: { id: true } }, scopeFields: { select: { id: true } } },
      })
    : null;
  if (serviceTypeId && !existing) {
    return res.status(404).json(errorResponse(404, 'Service type not found'));
  }

  const validationError = validateCatalog(
    body,
    new Set(existing?.tasks.map((t) => t.id) ?? []),
    new Set(existing?.scopeFields.map((f) => f.id) ?? [])
  );
  if (validationError) {
    return res.status(400).json(errorResponse(400, validationError));
  }

  const tasks = body.tasks!;
  const fields = body.scopeFields!;

  // Same minimum-wage guardrail as the single-job save (adminServiceTaskController).
  const doleNotes: string[] = [];
  for (const task of tasks) {
    if (task.pricingModel === 'CUSTOM_QUOTE') continue;
    const check = checkDoleFloor(getHighestDoleWageReference(), task.minPrice!, task.overrideReason);
    if (check.blocked) {
      return res.status(400).json(errorResponse(400, `Job "${task.name!.trim()}": ${check.message}`));
    }
    if (check.note) doleNotes.push(`${task.name!.trim()}: ${check.note}`);
  }

  const categoryData = {
    name: body.name!.trim(),
    description: body.description?.trim() || null,
    basePrice: body.basePrice!,
    icon: body.icon || null,
    requiresCertification: body.requiresCertification ?? false,
  };

  const record = await prisma.$transaction(
    async (tx) => {
      const category = existing
        ? await tx.serviceType.update({ where: { id: existing.id }, data: categoryData })
        : await tx.serviceType.create({ data: categoryData });

      // 1. Jobs, minus their count question (it may not exist yet).
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

      // 2. Questions, matched strictly by id: several jobs can have a question
      // with the same text, so the older match-by-label fallback would guess.
      const current = await tx.serviceScopeField.findMany({
        where: { serviceTypeId: category.id },
        include: { options: true },
      });
      const currentById = new Map(current.map((f) => [f.id, f]));
      const fieldIdByRef = new Map<string, string>();
      for (const [index, field] of fields.entries()) {
        const taskIds = (field.taskRefs ?? []).map((r) => taskIdByRef.get(r)!);
        const optionLabels = cleanOptionLabels(field);
        const data = { ...scopeFieldData(field, index), helpText: field.helpText?.trim() || null };
        const match = field.id ? currentById.get(field.id) : undefined;
        if (match) {
          currentById.delete(match.id);
          await tx.serviceScopeField.update({ where: { id: match.id }, data });
          await syncFieldOptions(tx, match.id, match.options, optionLabels);
          await tx.serviceScopeFieldTask.deleteMany({ where: { fieldId: match.id } });
          if (taskIds.length) {
            await tx.serviceScopeFieldTask.createMany({
              data: taskIds.map((serviceTaskId) => ({ fieldId: match.id, serviceTaskId })),
              skipDuplicates: true,
            });
          }
          fieldIdByRef.set(match.id, match.id);
        } else {
          const created = await tx.serviceScopeField.create({
            data: {
              serviceTypeId: category.id,
              ...data,
              options: { create: optionLabels.map((label, optIndex) => ({ label, sortOrder: optIndex })) },
              taskLinks: { create: [...new Set(taskIds)].map((serviceTaskId) => ({ serviceTaskId })) },
            },
          });
          fieldIdByRef.set(field.key!, created.id);
        }
      }
      if (currentById.size) {
        await tx.serviceScopeField.deleteMany({ where: { id: { in: [...currentById.keys()] } } });
      }

      // 3. Now every question has a real id, point per-unit jobs at their count.
      for (const task of tasks) {
        const hasQuantity = task.pricingModel === 'PER_UNIT' || task.pricingModel === 'TIERED';
        await tx.serviceTask.update({
          where: { id: taskIdByRef.get(refOf(task))! },
          data: { quantityScopeFieldId: hasQuantity ? fieldIdByRef.get(task.quantityFieldRef!)! : null },
        });
      }

      return tx.serviceType.findUniqueOrThrow({ where: { id: category.id }, include: serviceTypeInclude });
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
    message: `Service catalog ${existing ? 'updated' : 'created'}: ${record.name} (${tasks.length} jobs, ${fields.length} questions)${
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
