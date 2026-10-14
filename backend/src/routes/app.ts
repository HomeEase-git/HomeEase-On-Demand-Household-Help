import { Router } from 'express';
import { getAppSettings } from '@services/appSettingsService';
import { errorResponse } from '@utils/errorResponse';

const router = Router();

// Public (no auth): the app checks this before sign-in so even a logged-out
// install can be told to update. Values are admin-edited in Settings.
router.get('/version', async (_req, res) => {
  try {
    const s = await getAppSettings();
    return res.json({
      success: true,
      data: { latest: s.androidLatestVersion, minimum: s.androidMinVersion, storeUrl: s.androidStoreUrl },
    });
  } catch (error) {
    console.error('Get app version error:', error);
    return res.status(500).json(errorResponse(500, 'Internal server error'));
  }
});

export default router;
