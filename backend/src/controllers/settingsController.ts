import { Request, Response } from 'express';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { writeAuditLog } from '@utils/auditLog';
import { invalidateAppSettingsCache } from '@services/appSettingsService';
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
  maxDeclinesBeforeCooldown: number;
  declineWindowHours: number;
  declineCooldownHours: number;
  tierProMinRating: number;
  tierProMinJobs: number;
  tierProMultiplier: number;
  tierExpertMinRating: number;
  tierExpertMinJobs: number;
  tierExpertMultiplier: number;
  workerDebtHoldLimit: number;
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
    maxDeclinesBeforeCooldown: record.maxDeclinesBeforeCooldown,
    declineWindowHours: record.declineWindowHours,
    declineCooldownHours: record.declineCooldownHours,
    tierProMinRating: record.tierProMinRating,
    tierProMinJobs: record.tierProMinJobs,
    tierProMultiplier: record.tierProMultiplier,
    tierExpertMinRating: record.tierExpertMinRating,
    tierExpertMinJobs: record.tierExpertMinJobs,
    tierExpertMultiplier: record.tierExpertMultiplier,
    workerDebtHoldLimit: record.workerDebtHoldLimit,
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
      maxDeclinesBeforeCooldown,
      declineWindowHours,
      declineCooldownHours,
      tierProMinRating,
      tierProMinJobs,
      tierProMultiplier,
      tierExpertMinRating,
      tierExpertMinJobs,
      tierExpertMultiplier,
      workerDebtHoldLimit,
    } = req.body as {
      siteName?: string;
      supportEmail?: string;
      notificationsEnabled?: boolean;
      commissionRate?: number;
      withholdingTaxRate?: number;
      maxSlotsPerDay?: number;
      pendingExpiryMinutes?: number;
      geofenceRadiusMeters?: number;
      maxDeclinesBeforeCooldown?: number;
      declineWindowHours?: number;
      declineCooldownHours?: number;
      tierProMinRating?: number;
      tierProMinJobs?: number;
      tierProMultiplier?: number;
      tierExpertMinRating?: number;
      tierExpertMinJobs?: number;
      tierExpertMultiplier?: number;
      workerDebtHoldLimit?: number;
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
      ['maxDeclinesBeforeCooldown', maxDeclinesBeforeCooldown, 1, 20],
      ['declineWindowHours', declineWindowHours, 1, 720],
      ['declineCooldownHours', declineCooldownHours, 1, 720],
      ['tierProMinRating', tierProMinRating, 0, 5],
      ['tierProMinJobs', tierProMinJobs, 0, 10000],
      ['tierProMultiplier', tierProMultiplier, 1, 5],
      ['tierExpertMinRating', tierExpertMinRating, 0, 5],
      ['tierExpertMinJobs', tierExpertMinJobs, 0, 10000],
      ['tierExpertMultiplier', tierExpertMultiplier, 1, 5],
      ['workerDebtHoldLimit', workerDebtHoldLimit, 0, 100000],
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
        maxDeclinesBeforeCooldown: maxDeclinesBeforeCooldown ?? current.maxDeclinesBeforeCooldown,
        declineWindowHours: declineWindowHours ?? current.declineWindowHours,
        declineCooldownHours: declineCooldownHours ?? current.declineCooldownHours,
        tierProMinRating: tierProMinRating ?? current.tierProMinRating,
        tierProMinJobs: tierProMinJobs ?? current.tierProMinJobs,
        tierProMultiplier: tierProMultiplier ?? current.tierProMultiplier,
        tierExpertMinRating: tierExpertMinRating ?? current.tierExpertMinRating,
        tierExpertMinJobs: tierExpertMinJobs ?? current.tierExpertMinJobs,
        tierExpertMultiplier: tierExpertMultiplier ?? current.tierExpertMultiplier,
        workerDebtHoldLimit: workerDebtHoldLimit ?? current.workerDebtHoldLimit,
      },
    });

    invalidateAppSettingsCache();

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
