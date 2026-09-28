import { Request, Response } from 'express';
import type { AppSettings } from '@prisma/client';
import prisma from '@config/database';
import { errorResponse } from '@utils/errorResponse';
import { writeAuditLog } from '@utils/auditLog';
import { invalidateAppSettingsCache } from '@services/appSettingsService';
import type { JwtPayload } from '@/types/index';

interface AuthRequest extends Request {
  user?: JwtPayload;
}

// Every admin-editable number, with its allowed range. Every field is
// optional on update so each admin page (Settings, Price Adjustments, Commission & Debt, Tax
// Settings) can save just its own slice of this singleton.
const NUMERIC_FIELDS = {
  commissionRate: [0, 1],
  withholdingTaxRate: [0, 1],
  pendingExpiryMinutes: [5, 10080],
  geofenceRadiusMeters: [10, 5000],
  maxDeclinesBeforeCooldown: [1, 20],
  declineWindowHours: [1, 720],
  declineCooldownHours: [1, 720],
  tierProMinRating: [0, 5],
  tierProMinJobs: [0, 10000],
  tierProMinYears: [0, 60],
  tierProMultiplier: [1, 5],
  tierExpertMinRating: [0, 5],
  tierExpertMinJobs: [0, 10000],
  tierExpertMinYears: [0, 60],
  tierExpertMultiplier: [1, 5],
  freeDistanceKm: [0, 50],
  perKmFee: [0, 500],
  workerDebtHoldLimit: [0, 100000],
  workerMinAge: [18, 100],
  workerMaxAge: [18, 100],
  rushFeeRate: [0, 2],
  rushMinLeadHours: [0, 24],
  noShowGraceMinutes: [15, 480],
  noShowPenaltyAmount: [0, 100000],
  clientFaultCompensationAmount: [0, 100000],
  disputeEscalationHours: [1, 720],
} as const satisfies Partial<Record<keyof AppSettings, readonly [number, number]>>;

// Nullable "off by default" thresholds — null means disabled.
const NULLABLE_NUMERIC_FIELDS = {
  autoSuspendRatingThreshold: [0, 5],
  autoSuspendDisputeCountThreshold: [1, 1000],
  autoSuspendDisputeCountWindowDays: [1, 3650],
} as const satisfies Partial<Record<keyof AppSettings, readonly [number, number]>>;

type NumericField = keyof typeof NUMERIC_FIELDS;
type NullableNumericField = keyof typeof NULLABLE_NUMERIC_FIELDS;

function formatSettings(record: AppSettings) {
  const out: Record<string, unknown> = {
    siteName: record.siteName,
    supportEmail: record.supportEmail,
    notificationsEnabled: record.notificationsEnabled,
    atcCode: record.atcCode,
  };
  for (const field of Object.keys(NUMERIC_FIELDS) as NumericField[]) out[field] = record[field];
  for (const field of Object.keys(NULLABLE_NUMERIC_FIELDS) as NullableNumericField[]) out[field] = record[field];
  return out;
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
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { siteName, supportEmail, notificationsEnabled, atcCode } = body as {
      siteName?: string;
      supportEmail?: string;
      notificationsEnabled?: boolean;
      atcCode?: string | null;
    };

    if (atcCode !== undefined && atcCode !== null && typeof atcCode !== 'string') {
      return res.status(400).json(errorResponse(400, 'atcCode must be a string or null'));
    }

    // A field that IS sent can't be blanked, since both are shown publicly.
    if ((siteName !== undefined && !siteName?.trim()) || (supportEmail !== undefined && !supportEmail?.trim())) {
      return res.status(400).json(errorResponse(400, 'Site Name and Support Email are required.'));
    }

    const data: Record<string, unknown> = {};

    for (const [field, [min, max]] of Object.entries(NUMERIC_FIELDS)) {
      const value = body[field];
      if (value == null) continue;
      if (typeof value !== 'number' || Number.isNaN(value) || value < min || value > max) {
        return res.status(400).json(errorResponse(400, `${field} must be a number between ${min} and ${max}`));
      }
      data[field] = value;
    }

    for (const [field, [min, max]] of Object.entries(NULLABLE_NUMERIC_FIELDS)) {
      if (!(field in body)) continue;
      const value = body[field];
      if (value != null && (typeof value !== 'number' || Number.isNaN(value) || value < min || value > max)) {
        return res.status(400).json(errorResponse(400, `${field} must be null or a number between ${min} and ${max}`));
      }
      data[field] = value ?? null;
    }

    if (siteName !== undefined) data.siteName = siteName.trim();
    if (supportEmail !== undefined) data.supportEmail = supportEmail.trim();
    if (notificationsEnabled !== undefined) data.notificationsEnabled = notificationsEnabled;
    if (atcCode !== undefined) data.atcCode = atcCode?.trim() || null;

    const current = await prisma.appSettings.upsert({
      where: { id: 'singleton' },
      update: {},
      create: { id: 'singleton' },
    });

    const minAge = (data.workerMinAge as number | undefined) ?? current.workerMinAge;
    const maxAge = (data.workerMaxAge as number | undefined) ?? current.workerMaxAge;
    if (minAge > maxAge) {
      return res.status(400).json(errorResponse(400, 'The minimum worker age must not be above the maximum.'));
    }

    const record = await prisma.appSettings.update({ where: { id: 'singleton' }, data });

    invalidateAppSettingsCache();

    await writeAuditLog({
      actorId: req.user?.userId,
      actorName: req.user?.email,
      actorRole: req.user?.role,
      action: 'SETTINGS_UPDATED',
      category: 'ADMIN_ACTION',
      message: 'Admin settings updated',
      metadata: { fields: Object.keys(data) },
    });

    return res.json({ success: true, data: formatSettings(record) });
  } catch (error) {
    console.error('Update settings error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
};
