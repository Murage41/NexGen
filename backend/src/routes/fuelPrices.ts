import { Router } from 'express';
import db from '../database';
import { requireAdmin } from '../middleware/requireAdmin';
import { getKenyaDate } from '../utils/timezone';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const prices = await db('fuel_prices')
      .orderBy('effective_date', 'desc')
      .orderBy('id', 'desc');
    res.json({ success: true, data: prices });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET current prices (latest per fuel type)
// NOTE: Secondary `orderBy('id', 'desc')` is critical — when two rows share the
// same effective_date (e.g. correcting today's price), SQLite's tie-break is
// undefined without it and will silently return the older row, making the UI
// appear to ignore the update.
router.get('/current', async (_req, res) => {
  try {
    const today = getKenyaDate();
    const petrol = await db('fuel_prices')
      .where('fuel_type', 'petrol')
      .where('effective_date', '<=', today)
      .orderBy('effective_date', 'desc')
      .orderBy('id', 'desc')
      .first();
    const diesel = await db('fuel_prices')
      .where('fuel_type', 'diesel')
      .where('effective_date', '<=', today)
      .orderBy('effective_date', 'desc')
      .orderBy('id', 'desc')
      .first();
    res.json({ success: true, data: { petrol, diesel } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Returns the latest EPRA ceiling for a fuel type effective on the given date,
// or null if no ceiling has been set.
async function getCurrentEpraCeiling(fuel_type: string, asOfDate: string) {
  const row = await db('fuel_prices')
    .where('fuel_type', fuel_type)
    .whereNotNull('epra_max_price')
    .where(function () {
      this.whereNull('epra_effective_date').orWhere('epra_effective_date', '<=', asOfDate);
    })
    .orderBy('effective_date', 'desc')
    .orderBy('id', 'desc')
    .first();
  return row ? Number(row.epra_max_price) : null;
}

router.post('/', requireAdmin, async (req, res) => {
  try {
    const { fuel_type, price_per_litre, effective_date, epra_max_price, epra_effective_date, source } = req.body;

    // Phase 1B: enforce EPRA ceiling. If a ceiling was supplied in the request, use it;
    // otherwise look up the current ceiling for this fuel type.
    const ceiling = epra_max_price !== undefined && epra_max_price !== null
      ? Number(epra_max_price)
      : await getCurrentEpraCeiling(fuel_type, effective_date || getKenyaDate());
    if (ceiling !== null && Number(price_per_litre) > ceiling) {
      return res.status(400).json({
        success: false,
        error: `Price KES ${price_per_litre} exceeds EPRA ceiling of KES ${ceiling} for ${fuel_type}`,
      });
    }

    const [id] = await db('fuel_prices').insert({
      fuel_type,
      price_per_litre,
      effective_date,
      epra_max_price: epra_max_price ?? null,
      epra_effective_date: epra_effective_date ?? null,
      source: source || 'manual',
    });
    const price = await db('fuel_prices').where({ id }).first();
    res.status(201).json({ success: true, data: price });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update price for a fuel type (creates new history row)
router.put('/:fuel_type', requireAdmin, async (req, res) => {
  try {
    const { price_per_litre, effective_date, epra_max_price, epra_effective_date, source } = req.body;
    const fuel_type = req.params.fuel_type as string;
    if (!price_per_litre || !effective_date) {
      return res.status(400).json({ success: false, error: 'price_per_litre and effective_date are required' });
    }

    // Phase 1B: enforce EPRA ceiling
    const ceiling = epra_max_price !== undefined && epra_max_price !== null
      ? Number(epra_max_price)
      : await getCurrentEpraCeiling(fuel_type, effective_date as string);
    if (ceiling !== null && Number(price_per_litre) > ceiling) {
      return res.status(400).json({
        success: false,
        error: `Price KES ${price_per_litre} exceeds EPRA ceiling of KES ${ceiling} for ${fuel_type}`,
      });
    }

    // Always insert a new row to preserve history
    const [id] = await db('fuel_prices').insert({
      fuel_type,
      price_per_litre,
      effective_date,
      epra_max_price: epra_max_price ?? null,
      epra_effective_date: epra_effective_date ?? null,
      source: source || 'manual',
    });
    const price = await db('fuel_prices').where({ id }).first();
    res.json({ success: true, data: price });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Phase 1B: Apply an EPRA gazette update. Creates new fuel_prices rows tagged
 * source='epra' for the supplied fuel types. Existing pump price stays the same
 * unless explicitly set — this just records the new ceiling so the validator
 * can begin enforcing it.
 *
 * Body: { effective_date: 'YYYY-MM-DD', petrol_max?: number, diesel_max?: number }
 */
router.post('/epra-update', requireAdmin, async (req, res) => {
  try {
    const { effective_date, petrol_max, diesel_max } = req.body;
    if (!effective_date || !/^\d{4}-\d{2}-\d{2}$/.test(effective_date)) {
      return res.status(400).json({ success: false, error: 'effective_date (YYYY-MM-DD) is required' });
    }
    if (petrol_max == null && diesel_max == null) {
      return res.status(400).json({ success: false, error: 'At least one of petrol_max or diesel_max is required' });
    }

    const inserted: any[] = [];
    if (petrol_max != null) {
      // Use the most recent pump price (or the ceiling itself if there is none) so the row stays consistent
      const last = await db('fuel_prices').where('fuel_type', 'petrol').orderBy('effective_date', 'desc').orderBy('id', 'desc').first();
      const ppl = last ? Number(last.price_per_litre) : Number(petrol_max);
      const [id] = await db('fuel_prices').insert({
        fuel_type: 'petrol',
        price_per_litre: ppl,
        effective_date,
        epra_max_price: petrol_max,
        epra_effective_date: effective_date,
        source: 'epra',
      });
      inserted.push(await db('fuel_prices').where({ id }).first());
    }
    if (diesel_max != null) {
      const last = await db('fuel_prices').where('fuel_type', 'diesel').orderBy('effective_date', 'desc').orderBy('id', 'desc').first();
      const ppl = last ? Number(last.price_per_litre) : Number(diesel_max);
      const [id] = await db('fuel_prices').insert({
        fuel_type: 'diesel',
        price_per_litre: ppl,
        effective_date,
        epra_max_price: diesel_max,
        epra_effective_date: effective_date,
        source: 'epra',
      });
      inserted.push(await db('fuel_prices').where({ id }).first());
    }
    res.status(201).json({ success: true, data: inserted });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
