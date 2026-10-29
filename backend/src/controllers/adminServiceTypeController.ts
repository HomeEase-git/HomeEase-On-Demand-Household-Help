import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { writeAuditLog } from '@utils/auditLog';
import { VALID_SERVICE_ICONS } from '@/constants/serviceIcons';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

export const serviceTypeInclude = {
  tasks: { orderBy: [{ sortOrder: 'asc' as const }, { name: 'asc' as const }] },
};

function validateServiceTypeInput(body: {
  name?: string;
  basePrice?: number;
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

  return null;
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
    const { name, description, basePrice, icon, requiresCertification } = req.body as {
      name?: string;
      description?: string;
      basePrice?: number;
      icon?: string | null;
      requiresCertification?: boolean;
    };

    const validationError = validateServiceTypeInput({ name, basePrice, icon });
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
    const { name, description, basePrice, isActive, icon, requiresCertification } = req.body as {
      name?: string;
      description?: string;
      basePrice?: number;
      isActive?: boolean;
      icon?: string | null;
      requiresCertification?: boolean;
    };

    const validationError = validateServiceTypeInput({ name, basePrice, icon });
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
    const record = await prisma.serviceType.update({
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
