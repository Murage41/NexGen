import { Router } from 'express';
import db from '../database';
import { requireAdmin } from '../middleware/requireAdmin';
import { validate } from '../middleware/validate';
import { updateStationProfileSchema } from '../schemas';
import { MAX_LOGO_BYTES, getStationProfile, logoMime, setStationLogo, stationLogo, updateStationProfile } from '../services/stationProfile';

// The station profile (M8): read by everyone signed in (the phone shows it),
// changed by administrators only.
const router = Router();

router.get('/', async (_req, res) => {
  try {
    res.json({ success: true, data: await getStationProfile(db) });
  } catch (err: any) {
    console.error('[stationProfile:get] ERROR', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/', requireAdmin, validate(updateStationProfileSchema), async (req: any, res) => {
  console.log('[stationProfile:update]', req.body);
  try {
    res.json({ success: true, data: await updateStationProfile(db, req.body, req.employee?.id) });
  } catch (err: any) {
    console.error('[stationProfile:update] ERROR', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Body: { data_base64 } of a PNG or JPEG, up to 2 MB.
router.put('/logo', requireAdmin, async (req: any, res) => {
  console.log('[stationProfile:logo]', { bytes: String(req.body?.data_base64 || '').length });
  try {
    const raw = String(req.body?.data_base64 || '');
    const buffer = Buffer.from(raw.includes(',') ? raw.split(',').pop() || '' : raw, 'base64');
    if (buffer.length === 0) return res.status(400).json({ success: false, error: 'Choose a logo picture to upload.' });
    if (buffer.length > MAX_LOGO_BYTES) return res.status(400).json({ success: false, error: 'The logo is too large. Use a picture under 2 MB.' });
    if (!logoMime(buffer)) return res.status(400).json({ success: false, error: 'The logo must be a PNG or JPEG picture.' });
    await setStationLogo(db, buffer, req.employee?.id);
    res.json({ success: true, data: await getStationProfile(db) });
  } catch (err: any) {
    console.error('[stationProfile:logo] ERROR', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Back to the logo that ships with NexGen.
router.delete('/logo', requireAdmin, async (req: any, res) => {
  console.log('[stationProfile:logo:clear]');
  try {
    await setStationLogo(db, null, req.employee?.id);
    res.json({ success: true, data: await getStationProfile(db) });
  } catch (err: any) {
    console.error('[stationProfile:logo:clear] ERROR', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// The logo picture itself. Public (it is on the station's canopy) so screens can
// show it in an <img>, including the phone's sign-in page.
export async function serveStationLogo(_req: any, res: any) {
  try {
    const logo = await stationLogo(db);
    res.setHeader('Content-Type', logo.mime);
    res.setHeader('Cache-Control', 'no-cache');
    res.send(logo.data);
  } catch (err: any) {
    console.error('[stationProfile:logo:get] ERROR', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

export default router;
