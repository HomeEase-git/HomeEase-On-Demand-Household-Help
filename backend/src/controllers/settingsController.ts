import { Request, Response } from 'express';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { writeAuditLog } from '@utils/auditLog';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

function formatSettings(record: {
  siteName: string;
  supportEmail: string;
  notificationsEnabled: boolean;
  commissionRate: number;
  withholdingTaxRate: number;
  maxSlotsPerDay: number;
  pendingExpiryMinutes: number;
  geofenceRadiusMeters: number;
}) {
  return {
    siteName: record.siteName,
    supportEmail: record.supportEmail,
    notificationsEnabled: record.notificationsEnabled,
    commissionRate: record.commissionRate,
    withholdingTaxRate: record.withholdingTaxRate,
    maxSlotsPerDay: record.maxSlotsPerDay,
    pendingExpiryMinutes: record.pendingExpiryMinutes,
    geofenceRadiusMeters: record.geofenceRadiusMeters,
  };
}

export const getSettings = async (_req: Request, res: Response) => {
  try {
    const record = await prisma.appSettings.upsert({
      where: { id: 'singleton' },
      update: {},
      create: { id: 'singleton' },
    });

    return res.json({ success: true, data: formatSettings(record) });
  } catch (error) {
    console.error('Get settings error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};

export const updateSettings = async (req: AuthRequest, res: Response) => {
  try {
    const {
      siteName,
      supportEmail,
      notificationsEnabled,
      commissionRate,
      withholdingTaxRate,
      maxSlotsPerDay,
      pendingExpiryMinutes,
      geofenceRadiusMeters,
    } = req.body as {
      siteName?: string;
      supportEmail?: string;
      notificationsEnabled?: boolean;
      commissionRate?: number;
      withholdingTaxRate?: number;
      maxSlotsPerDay?: number;
      pendingExpiryMinutes?: number;
      geofenceRadiusMeters?: number;
    };

    if (!siteName?.trim() || !supportEmail?.trim()) {
      return res.status(400).json(errorResponse(400, 'Site Name and Support Email are required.'));
    }

    const numericFields: Array<[string, number | undefined, number, number]> = [
      ['commissionRate', commissionRate, 0, 1],
      ['withholdingTaxRate', withholdingTaxRate, 0, 1],
      ['maxSlotsPerDay', maxSlotsPerDay, 1, 24],
      ['pendingExpiryMinutes', pendingExpiryMinutes, 5, 10080],
      ['geofenceRadiusMeters', geofenceRadiusMeters, 10, 5000],
    ];
    for (const [field, value, min, max] of numericFields) {
      if (value != null && (typeof value !== 'number' || Number.isNaN(value) || value < min || value > max)) {
        return res.status(400).json(errorResponse(400, `${field} must be a number between ${min} and ${max}`));
      }
    }

    const current = await prisma.appSettings.upsert({
      where: { id: 'singleton' },
      update: {},
      create: { id: 'singleton' },
    });

    const record = await prisma.appSettings.update({
      where: { id: 'singleton' },
      data: {
        siteName: siteName.trim(),
        supportEmail: supportEmail.trim(),
        notificationsEnabled: notificationsEnabled ?? true,
        commissionRate: commissionRate ?? current.commissionRate,
        withholdingTaxRate: withholdingTaxRate ?? current.withholdingTaxRate,
        maxSlotsPerDay: maxSlotsPerDay ?? current.maxSlotsPerDay,
        pendingExpiryMinutes: pendingExpiryMinutes ?? current.pendingExpiryMinutes,
        geofenceRadiusMeters: geofenceRadiusMeters ?? current.geofenceRadiusMeters,
      },
    });

    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'SETTINGS_UPDATED',
      category: 'ADMIN_ACTION',
      message: 'Admin settings updated',
    });

    return res.json({ success: true, data: formatSettings(record) });
  } catch (error) {
    console.error('Update settings error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};
