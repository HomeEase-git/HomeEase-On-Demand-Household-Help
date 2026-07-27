import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { writeAuditLog } from '@utils/auditLog';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

function buildPricingRuleWhere(search: string): Prisma.PricingRuleWhereInput {
  if (!search) return {};
  return {
    OR: [{ city: { contains: search } }, { serviceType: { contains: search } }],
  };
}

function formatPricingRule(record: {
  id: string;
  city: string;
  serviceType: string;
  minPrice: number;
  maxPrice: number;
}) {
  return {
    id: record.id,
    city: record.city,
    serviceType: record.serviceType,
    minPrice: record.minPrice,
    maxPrice: record.maxPrice,
  };
}

function validatePricingRuleInput(body: {
  city?: string;
  serviceType?: string;
  minPrice?: number;
  maxPrice?: number;
}): string | null {
  if (!body.city?.trim() || !body.serviceType?.trim()) {
    return 'City and Service Type are required.';
  }
  if (typeof body.minPrice !== 'number' || typeof body.maxPrice !== 'number') {
    return 'Min and Max price must be valid numbers.';
  }
  if (body.minPrice < 0 || body.maxPrice < 0) {
    return 'Prices cannot be negative.';
  }
  if (body.minPrice > body.maxPrice) {
    return 'Min price cannot be greater than Max price.';
  }
  return null;
}

export const listPricingRules = async (req: Request, res: Response) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const records = await prisma.pricingRule.findMany({
      where: buildPricingRuleWhere(search),
      orderBy: [{ city: 'asc' }, { serviceType: 'asc' }],
    });

    return res.json({ success: true, data: records.map(formatPricingRule) });
  } catch (error) {
    console.error('List pricing rules error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const createPricingRule = async (req: AuthRequest, res: Response) => {
  try {
    const { city, serviceType, minPrice, maxPrice } = req.body as {
      city?: string;
      serviceType?: string;
      minPrice?: number;
      maxPrice?: number;
    };

    const validationError = validatePricingRuleInput({ city, serviceType, minPrice, maxPrice });
    if (validationError) {
      return res.status(400).json(errorResponse(400, validationError));
    }

    const record = await prisma.pricingRule.create({
      data: {
        city: city!.trim(),
        serviceType: serviceType!.trim(),
        minPrice: minPrice!,
        maxPrice: maxPrice!,
      },
    });

    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'PRICING_RULE_CREATED',
      category: 'ADMIN_ACTION',
      message: `Pricing rule created for ${record.city} / ${record.serviceType}`,
    });

    return res.status(201).json({ success: true, data: formatPricingRule(record) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res
        .status(409)
        .json(errorResponse(409, 'A rule for this City + Service Type already exists. Please edit it instead.'));
    }
    console.error('Create pricing rule error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const updatePricingRule = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { city, serviceType, minPrice, maxPrice } = req.body as {
      city?: string;
      serviceType?: string;
      minPrice?: number;
      maxPrice?: number;
    };

    const validationError = validatePricingRuleInput({ city, serviceType, minPrice, maxPrice });
    if (validationError) {
      return res.status(400).json(errorResponse(400, validationError));
    }

    const existing = await prisma.pricingRule.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json(errorResponse(404, 'Pricing rule not found'));
    }

    const record = await prisma.pricingRule.update({
      where: { id },
      data: {
        city: city!.trim(),
        serviceType: serviceType!.trim(),
        minPrice: minPrice!,
        maxPrice: maxPrice!,
      },
    });

    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'PRICING_RULE_UPDATED',
      category: 'ADMIN_ACTION',
      message: `Pricing rule updated for ${record.city} / ${record.serviceType}`,
    });

    return res.json({ success: true, data: formatPricingRule(record) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res
        .status(409)
        .json(errorResponse(409, 'Another rule with this City + Service Type already exists.'));
    }
    console.error('Update pricing rule error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const deletePricingRule = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;

    const existing = await prisma.pricingRule.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json(errorResponse(404, 'Pricing rule not found'));
    }

    await prisma.pricingRule.delete({ where: { id } });

    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'PRICING_RULE_DELETED',
      category: 'ADMIN_ACTION',
      message: `Pricing rule deleted for ${existing.city} / ${existing.serviceType}`,
    });

    return res.json({ success: true, data: { id } });
  } catch (error) {
    console.error('Delete pricing rule error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};
