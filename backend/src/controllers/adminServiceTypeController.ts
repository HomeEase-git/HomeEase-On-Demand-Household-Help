import { Request, Response } from 'express';
import { Prisma, ScopeFieldType } from '@prisma/client';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { writeAuditLog } from '@utils/auditLog';
import { VALID_SERVICE_ICONS } from '@/constants/serviceIcons';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

export const VALID_FIELD_TYPES: ScopeFieldType[] = ['TEXT', 'SELECT', 'MULTI_SELECT', 'NUMBER'];
export const OPTION_FIELD_TYPES: ScopeFieldType[] = ['SELECT', 'MULTI_SELECT'];

export const serviceTypeInclude = {
  tasks: {
    orderBy: [{ sortOrder: 'asc' as const }, { name: 'asc' as const }],
    include: { quantityScopeField: { select: { id: true, label: true } } },
  },
  scopeFields: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      options: { orderBy: { sortOrder: 'asc' as const } },
      taskLinks: { select: { serviceTaskId: true } },
    },
  },
};

export type ScopeFieldInput = {
  // Existing field to update in place. When absent, a field is matched to an
  // existing one by exact label instead (the admin web has never sent ids).
  id?: string;
  label?: string;
  helpText?: string | null;
  fieldType?: string;
  required?: boolean;
  options?: string[];
  minValue?: number | null;
  maxValue?: number | null;
  usedForMatching?: boolean;
  // Jobs (ServiceTask ids in this category) the question is limited to.
  // [] = every job. Omitted on update = keep the field's current links.
  taskIds?: string[];
};

function validateServiceTypeInput(body: {
  name?: string;
  basePrice?: number;
  scopeFields?: ScopeFieldInput[];
  icon?: string | null;
}): string | null {
  if (!body.name?.trim()) {
    return 'Name is required.';
  }
  if (typeof body.basePrice !== 'number' || Number.isNaN(body.basePrice) || body.basePrice < 0) {
    return 'Base price must be a non-negative number.';
  }
  if (body.icon != null && !VALID_SERVICE_ICONS.includes(body.icon as (typeof VALID_SERVICE_ICONS)[number])) {
    return `icon must be one of the curated set: ${VALID_SERVICE_ICONS.join(', ')}.`;
  }

  if (Array.isArray(body.scopeFields)) {
    const seenLabels = new Set<string>();
    for (const field of body.scopeFields) {
      if (!field.label?.trim()) {
        return 'Each field needs a non-empty label.';
      }
      // Booking answers are keyed by label, so two fields with the same one
      // would overwrite each other's answer.
      const labelKey = field.label.trim().toLowerCase();
      if (seenLabels.has(labelKey)) {
        return `Two fields are both labeled "${field.label.trim()}". Each field needs its own label.`;
      }
      seenLabels.add(labelKey);
      if (
        field.taskIds !== undefined &&
        (!Array.isArray(field.taskIds) || !field.taskIds.every((t) => typeof t === 'string'))
      ) {
        return `Field "${field.label}"'s taskIds must be a list of job ids.`;
      }
      if (!field.fieldType || !VALID_FIELD_TYPES.includes(field.fieldType as ScopeFieldType)) {
        return `Each field's fieldType must be one of ${VALID_FIELD_TYPES.join(', ')}.`;
      }
      if (
        OPTION_FIELD_TYPES.includes(field.fieldType as ScopeFieldType) &&
        (!Array.isArray(field.options) || field.options.filter((o) => o?.trim()).length === 0)
      ) {
        return `Field "${field.label}" needs at least one option.`;
      }
      if (
        field.usedForMatching &&
        !OPTION_FIELD_TYPES.includes(field.fieldType as ScopeFieldType)
      ) {
        return `Field "${field.label}" can only be used to match workers if it's a single- or multi-choice field.`;
      }
      if (
        field.fieldType === 'NUMBER' &&
        field.minValue != null &&
        field.maxValue != null &&
        field.minValue > field.maxValue
      ) {
        return `Field "${field.label}"'s minimum value can't be greater than its maximum.`;
      }
    }
  }

  return null;
}

export function isOptionField(fieldType: string | undefined) {
  return OPTION_FIELD_TYPES.includes(fieldType as ScopeFieldType);
}

export function scopeFieldData(field: ScopeFieldInput, index: number) {
  return {
    label: field.label!.trim(),
    // Omitted = leave as is (older admin builds never send it).
    helpText: field.helpText === undefined ? undefined : field.helpText?.trim() || null,
    fieldType: field.fieldType as ScopeFieldType,
    required: field.required !== false,
    sortOrder: index,
    minValue: field.fieldType === 'NUMBER' ? field.minValue ?? null : null,
    maxValue: field.fieldType === 'NUMBER' ? field.maxValue ?? null : null,
    usedForMatching: isOptionField(field.fieldType) ? field.usedForMatching ?? false : false,
  };
}

export function cleanOptionLabels(field: ScopeFieldInput): string[] {
  return isOptionField(field.fieldType) ? (field.options ?? []).filter((o) => o?.trim()).map((o) => o.trim()) : [];
}

function buildScopeFieldsCreate(scopeFields: ScopeFieldInput[] | undefined) {
  if (!Array.isArray(scopeFields)) return undefined;
  return scopeFields.map((field, index) => ({
    ...scopeFieldData(field, index),
    options: isOptionField(field.fieldType)
      ? { create: cleanOptionLabels(field).map((label, optIndex) => ({ label, sortOrder: optIndex })) }
      : undefined,
  }));
}

/** An error message when any field links to a job outside this category, else null. */
function findForeignTaskLink(scopeFields: ScopeFieldInput[] | undefined, categoryTaskIds: Set<string>): string | null {
  for (const field of scopeFields ?? []) {
    if ((field.taskIds ?? []).some((t) => !categoryTaskIds.has(t))) {
      return `Field "${field.label?.trim()}" is linked to a job that isn't in this category.`;
    }
  }
  return null;
}

/**
 * Options are matched by label, so a worker's capability pointing at an
 * option that still exists survives the save; only removed options are
 * deleted.
 */
export async function syncFieldOptions(
  tx: Prisma.TransactionClient,
  fieldId: string,
  currentOptions: { id: string; label: string; sortOrder: number }[],
  optionLabels: string[]
) {
  const existingOptions = new Map(currentOptions.map((o) => [o.label, o]));
  for (const [optIndex, label] of optionLabels.entries()) {
    const option = existingOptions.get(label);
    if (option) {
      existingOptions.delete(label);
      if (option.sortOrder !== optIndex) {
        await tx.serviceScopeFieldOption.update({ where: { id: option.id }, data: { sortOrder: optIndex } });
      }
    } else {
      await tx.serviceScopeFieldOption.create({ data: { fieldId, label, sortOrder: optIndex } });
    }
  }
  if (existingOptions.size) {
    await tx.serviceScopeFieldOption.deleteMany({
      where: { id: { in: [...existingOptions.values()].map((o) => o.id) } },
    });
  }
}

/**
 * Brings a category's scope fields in line with `scopeFields`, updating
 * matching fields in place instead of deleting and recreating them all.
 * Recreating used to wipe everything pointing at a field id on every admin
 * save — a PER_UNIT task's quantityScopeFieldId (SetNull) and workers'
 * WorkerScopeFieldCapability rows (cascade via options) — and would now wipe
 * ServiceScopeFieldTask links too. Only fields and options that were really
 * removed are deleted. Booking.scopeAnswers snapshots by label, so past
 * bookings aren't affected either way.
 */
async function syncScopeFields(tx: Prisma.TransactionClient, serviceTypeId: string, scopeFields: ScopeFieldInput[]) {
  const existing = await tx.serviceScopeField.findMany({ where: { serviceTypeId }, include: { options: true } });
  const unmatched = new Map(existing.map((f) => [f.id, f]));
  const takeMatch = (field: ScopeFieldInput) => {
    const byId = field.id ? unmatched.get(field.id) : undefined;
    const match = byId ?? [...unmatched.values()].find((f) => f.label === field.label!.trim());
    if (match) unmatched.delete(match.id);
    return match;
  };

  for (const [index, field] of scopeFields.entries()) {
    const match = takeMatch(field);
    const optionLabels = cleanOptionLabels(field);

    if (!match) {
      await tx.serviceScopeField.create({
        data: {
          serviceTypeId,
          ...scopeFieldData(field, index),
          options: { create: optionLabels.map((label, optIndex) => ({ label, sortOrder: optIndex })) },
          taskLinks: { create: (field.taskIds ?? []).map((serviceTaskId) => ({ serviceTaskId })) },
        },
      });
      continue;
    }

    await tx.serviceScopeField.update({ where: { id: match.id }, data: scopeFieldData(field, index) });
    await syncFieldOptions(tx, match.id, match.options, optionLabels);

    if (field.taskIds !== undefined) {
      await tx.serviceScopeFieldTask.deleteMany({ where: { fieldId: match.id } });
      if (field.taskIds.length) {
        await tx.serviceScopeFieldTask.createMany({
          data: field.taskIds.map((serviceTaskId) => ({ fieldId: match.id, serviceTaskId })),
          skipDuplicates: true,
        });
      }
    }
  }

  if (unmatched.size) {
    await tx.serviceScopeField.deleteMany({ where: { id: { in: [...unmatched.keys()] } } });
  }
}

export const listServiceTypesAdmin = async (_req: Request, res: Response) => {
  try {
    const records = await prisma.serviceType.findMany({
      include: serviceTypeInclude,
      orderBy: { name: 'asc' },
    });

    return res.json({ success: true, data: records });
  } catch (error) {
    console.error('List service types error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const createServiceType = async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, basePrice, scopeFields, icon, requiresCertification } = req.body as {
      name?: string;
      description?: string;
      basePrice?: number;
      scopeFields?: ScopeFieldInput[];
      icon?: string | null;
      requiresCertification?: boolean;
    };

    const validationError = validateServiceTypeInput({ name, basePrice, scopeFields, icon });
    if (validationError) {
      return res.status(400).json(errorResponse(400, validationError));
    }
    if (requiresCertification !== undefined && typeof requiresCertification !== 'boolean') {
      return res.status(400).json(errorResponse(400, 'requiresCertification must be a boolean.'));
    }
    const foreignTaskError = findForeignTaskLink(scopeFields, new Set());
    if (foreignTaskError) {
      return res
        .status(400)
        .json(errorResponse(400, `${foreignTaskError} Add the category's jobs first, then link questions to them.`));
    }

    const record = await prisma.serviceType.create({
      data: {
        name: name!.trim(),
        description: description?.trim() || null,
        basePrice: basePrice!,
        icon: icon || null,
        requiresCertification: requiresCertification ?? false,
        scopeFields: { create: buildScopeFieldsCreate(scopeFields) },
      },
      include: serviceTypeInclude,
    });

    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'SERVICE_TYPE_CREATED',
      category: 'ADMIN_ACTION',
      message: `Service type created: ${record.name}`,
    });

    return res.status(201).json({ success: true, data: record });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json(errorResponse(409, 'A service with this name already exists.'));
    }
    console.error('Create service type error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const updateServiceType = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { name, description, basePrice, scopeFields, isActive, icon, requiresCertification } = req.body as {
      name?: string;
      description?: string;
      basePrice?: number;
      scopeFields?: ScopeFieldInput[];
      isActive?: boolean;
      icon?: string | null;
      requiresCertification?: boolean;
    };

    const validationError = validateServiceTypeInput({ name, basePrice, scopeFields, icon });
    if (validationError) {
      return res.status(400).json(errorResponse(400, validationError));
    }
    if (isActive !== undefined && typeof isActive !== 'boolean') {
      return res.status(400).json(errorResponse(400, 'isActive must be a boolean.'));
    }
    if (requiresCertification !== undefined && typeof requiresCertification !== 'boolean') {
      return res.status(400).json(errorResponse(400, 'requiresCertification must be a boolean.'));
    }

    const existing = await prisma.serviceType.findUnique({
      where: { id },
      include: { tasks: { select: { id: true } } },
    });
    if (!existing) {
      return res.status(404).json(errorResponse(404, 'Service type not found'));
    }
    const foreignTaskError = findForeignTaskLink(scopeFields, new Set(existing.tasks.map((t) => t.id)));
    if (foreignTaskError) {
      return res.status(400).json(errorResponse(400, foreignTaskError));
    }

    const record = await prisma.$transaction(async (tx) => {
      // An omitted scopeFields leaves the fields alone, like the other
      // optional properties here; [] still clears them.
      if (Array.isArray(scopeFields)) {
        await syncScopeFields(tx, id, scopeFields);
      }

      return tx.serviceType.update({
        where: { id },
        data: {
          name: name!.trim(),
          description: description?.trim() || null,
          basePrice: basePrice!,
          isActive: isActive ?? existing.isActive,
          icon: icon !== undefined ? icon || null : existing.icon,
          requiresCertification: requiresCertification ?? existing.requiresCertification,
        },
        include: serviceTypeInclude,
      });
    });

    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'SERVICE_TYPE_UPDATED',
      category: 'ADMIN_ACTION',
      message: `Service type updated: ${record.name}`,
    });

    return res.json({ success: true, data: record });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json(errorResponse(409, 'Another service with this name already exists.'));
    }
    console.error('Update service type error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const toggleServiceTypeActive = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { isActive } = req.body as { isActive?: boolean };

    if (typeof isActive !== 'boolean') {
      return res.status(400).json(errorResponse(400, 'isActive must be a boolean.'));
    }

    const existing = await prisma.serviceType.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json(errorResponse(404, 'Service type not found'));
    }

    const record = await prisma.serviceType.update({
      where: { id },
      data: { isActive },
      include: serviceTypeInclude,
    });

    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: isActive ? 'SERVICE_TYPE_ACTIVATED' : 'SERVICE_TYPE_DEACTIVATED',
      category: 'ADMIN_ACTION',
      message: `Service type ${isActive ? 'activated' : 'deactivated'}: ${record.name}`,
    });

    return res.json({ success: true, data: record });
  } catch (error) {
    console.error('Toggle service type active error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};
