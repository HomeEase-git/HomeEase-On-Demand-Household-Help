import { Request, Response } from 'express';
import { Prisma, ScopeFieldType, ServiceScopeType } from '@prisma/client';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { writeAuditLog } from '@utils/auditLog';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

const VALID_SCOPE_TYPES: ServiceScopeType[] = ['ROOM_BASED', 'CUSTOM'];
const VALID_FIELD_TYPES: ScopeFieldType[] = ['TEXT', 'SELECT', 'MULTI_SELECT'];

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
};

function validateServiceTypeInput(body: {
  name?: string;
  basePrice?: number;
  scopeType?: string;
  hasCondition?: boolean;
  scopeFields?: ScopeFieldInput[];
}): string | null {
  if (!body.name?.trim()) {
    return 'Name is required.';
  }
  if (typeof body.basePrice !== 'number' || Number.isNaN(body.basePrice) || body.basePrice < 0) {
    return 'Base price must be a non-negative number.';
  }
  if (body.scopeType !== undefined && !VALID_SCOPE_TYPES.includes(body.scopeType as ServiceScopeType)) {
    return `scopeType must be one of ${VALID_SCOPE_TYPES.join(', ')}.`;
  }
  if (body.hasCondition !== undefined && typeof body.hasCondition !== 'boolean') {
    return 'hasCondition must be a boolean.';
  }

  const scopeType = (body.scopeType as ServiceScopeType) ?? 'ROOM_BASED';
  if (scopeType === 'CUSTOM') {
    if (!Array.isArray(body.scopeFields) || body.scopeFields.length === 0) {
      return 'At least one custom field is required when scopeType is CUSTOM.';
    }
    for (const field of body.scopeFields) {
      if (!field.label?.trim()) {
        return 'Each custom field needs a non-empty label.';
      }
      if (!field.fieldType || !VALID_FIELD_TYPES.includes(field.fieldType as ScopeFieldType)) {
        return `Each custom field's fieldType must be one of ${VALID_FIELD_TYPES.join(', ')}.`;
      }
      if (
        (field.fieldType === 'SELECT' || field.fieldType === 'MULTI_SELECT') &&
        (!Array.isArray(field.options) || field.options.filter((o) => o?.trim()).length === 0)
      ) {
        return `Field "${field.label}" needs at least one option.`;
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
    options:
      field.fieldType === 'SELECT' || field.fieldType === 'MULTI_SELECT'
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
    const { name, description, basePrice, scopeType, hasCondition, scopeFields } = req.body as {
      name?: string;
      description?: string;
      basePrice?: number;
      scopeType?: string;
      hasCondition?: boolean;
      scopeFields?: ScopeFieldInput[];
    };

    const validationError = validateServiceTypeInput({ name, basePrice, scopeType, hasCondition, scopeFields });
    if (validationError) {
      return res.status(400).json(errorResponse(400, validationError));
    }

    const resolvedScopeType = (scopeType as ServiceScopeType) ?? 'ROOM_BASED';

    const record = await prisma.serviceType.create({
      data: {
        name: name!.trim(),
        description: description?.trim() || null,
        basePrice: basePrice!,
        scopeType: resolvedScopeType,
        hasCondition: hasCondition ?? true,
        scopeFields:
          resolvedScopeType === 'CUSTOM'
            ? { create: buildScopeFieldsCreate(scopeFields) }
            : undefined,
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
    const { name, description, basePrice, scopeType, hasCondition, scopeFields, isActive } = req.body as {
      name?: string;
      description?: string;
      basePrice?: number;
      scopeType?: string;
      hasCondition?: boolean;
      scopeFields?: ScopeFieldInput[];
      isActive?: boolean;
    };

    const validationError = validateServiceTypeInput({ name, basePrice, scopeType, hasCondition, scopeFields });
    if (validationError) {
      return res.status(400).json(errorResponse(400, validationError));
    }
    if (isActive !== undefined && typeof isActive !== 'boolean') {
      return res.status(400).json(errorResponse(400, 'isActive must be a boolean.'));
    }

    const existing = await prisma.serviceType.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json(errorResponse(404, 'Service type not found'));
    }

    const resolvedScopeType = (scopeType as ServiceScopeType) ?? 'ROOM_BASED';

    const record = await prisma.$transaction(async (tx) => {
      // Replace-all for scope fields — Booking.scopeAnswers snapshots by
      // field label, not id, so past bookings aren't affected by this.
      await tx.serviceScopeField.deleteMany({ where: { serviceTypeId: id } });

      return tx.serviceType.update({
        where: { id },
        data: {
          name: name!.trim(),
          description: description?.trim() || null,
          basePrice: basePrice!,
          scopeType: resolvedScopeType,
          hasCondition: hasCondition ?? true,
          isActive: isActive ?? existing.isActive,
          scopeFields:
            resolvedScopeType === 'CUSTOM'
              ? { create: buildScopeFieldsCreate(scopeFields) }
              : undefined,
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
