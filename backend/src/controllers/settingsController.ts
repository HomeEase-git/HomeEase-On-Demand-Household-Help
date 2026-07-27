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
}) {
  return {
    siteName: record.siteName,
    supportEmail: record.supportEmail,
    notificationsEnabled: record.notificationsEnabled,
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
    const { siteName, supportEmail, notificationsEnabled } = req.body as {
      siteName?: string;
      supportEmail?: string;
      notificationsEnabled?: boolean;
    };

    if (!siteName?.trim() || !supportEmail?.trim()) {
      return res.status(400).json(errorResponse(400, 'Site Name and Support Email are required.'));
    }

    const record = await prisma.appSettings.upsert({
      where: { id: 'singleton' },
      update: {
        siteName: siteName.trim(),
        supportEmail: supportEmail.trim(),
        notificationsEnabled: notificationsEnabled ?? true,
      },
      create: {
        id: 'singleton',
        siteName: siteName.trim(),
        supportEmail: supportEmail.trim(),
        notificationsEnabled: notificationsEnabled ?? true,
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
