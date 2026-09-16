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

const VALID_FIELD_TYPES: ScopeFieldType[] = ['TEXT', 'SELECT', 'MULTI_SELECT', 'NUMBER'];
const OPTION_FIELD_TYPES: ScopeFieldType[] = ['SELECT', 'MULTI_SELECT'];

const serviceTypeInclude = {
  tasks: true,
  scopeFields: {
    orderBy: { sortOrder: 'asc' as const },
    include: { options: { orderBy: { sortOrder: 'asc' as const } } },
  },
};

type ScopeFieldInput = {
  label?: string;
  fieldType?: string;
  required?: boolean;
  options?: string[];
  minValue?: number | null;
  maxValue?: number | null;
  usedForMatching?: boolean;
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
    for (const field of body.scopeFields) {
      if (!field.label?.trim()) {
        return 'Each field needs a non-empty label.';
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

function buildScopeFieldsCreate(scopeFields: ScopeFieldInput[] | undefined) {
  if (!Array.isArray(scopeFields)) return undefined;
  return scopeFields.map((field, index) => ({
    label: field.label!.trim(),
    fieldType: field.fieldType as ScopeFieldType,
    required: field.required !== false,
    sortOrder: index,
    minValue: field.fieldType === 'NUMBER' ? field.minValue ?? null : null,
    maxValue: field.fieldType === 'NUMBER' ? field.maxValue ?? null : null,
    usedForMatching: OPTION_FIELD_TYPES.includes(field.fieldType as ScopeFieldType)
      ? field.usedForMatching ?? false
      : false,
    options: OPTION_FIELD_TYPES.includes(field.fieldType as ScopeFieldType)
      ? {
          create: (field.options ?? [])
            .filter((o) => o?.trim())
            .map((label, optIndex) => ({ label: label.trim(), sortOrder: optIndex })),
        }
      : undefined,
  }));
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

    const existing = await prisma.serviceType.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json(errorResponse(404, 'Service type not found'));
    }

    const record = await prisma.$transaction(async (tx) => {
      // Replace-all for scope fields — Booking.scopeAnswers snapshots by
      // field label, not id, so past bookings aren't affected by this.
      // ServiceScopeFieldOption cascade-deletes, which also clears any
      // WorkerScopeFieldCapability rows pointed at those options.
      await tx.serviceScopeField.deleteMany({ where: { serviceTypeId: id } });

      return tx.serviceType.update({
        where: { id },
        data: {
          name: name!.trim(),
          description: description?.trim() || null,
          basePrice: basePrice!,
          isActive: isActive ?? existing.isActive,
          icon: icon !== undefined ? icon || null : existing.icon,
          requiresCertification: requiresCertification ?? existing.requiresCertification,
          scopeFields: { create: buildScopeFieldsCreate(scopeFields) },
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
