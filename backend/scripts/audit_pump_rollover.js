// READ-ONLY pump-meter rollover audit.
//
// Goal: before any rollover-related schema/code change, prove that:
//   (a) every stored reading has closing >= opening (current invariant),
//   (b) litres_sold / amount_sold match closing - opening,
//   (c) shift-to-shift continuity holds (this opening == previous closing),
//   (d) freeze totals so post-migration we can confirm nothing shifted.
//
// Also surfaces:
//   - readings near a 1,000,000 rollover boundary (next shift may roll),
//   - the largest single-shift sales (eyeball for typos / missed comp).
//
// Pure SELECTs. Safe to run against the live DB.

const path = require('path');
const knex = require('knex')({
  client: 'sqlite3',
  connection: { filename: path.join(__dirname, '..', 'data', 'nexgen.db') },
  useNullAsDefault: true,
});

const ROLLOVER_CAP = 1_000_000;
const NEAR_BOUNDARY = 950_000;
const TOP_N = 10;

const fmt = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (n) => Math.round(Number(n) * 100) / 100;

let errors = 0;
let warnings = 0;
const err = (msg) => { errors++; console.log('  ✗ ' + msg); };
const warn = (msg) => { warnings++; console.log('  ⚠ ' + msg); };
const ok = (msg) => console.log('  ✓ ' + msg);

(async () => {
  console.log('=== Pump-meter rollover audit (read-only) ===');
  console.log(`DB:       ${path.join(__dirname, '..', 'data', 'nexgen.db')}`);
  console.log(`Run at:   ${new Date().toISOString()}`);
  console.log(`Capacity: ${ROLLOVER_CAP.toLocaleString()} (assumed for both litres & amount)\n`);

  const pumps = await knex('pumps').orderBy('id', 'asc');

  // ------- per-pump continuity walk -------
  for (const p of pumps) {
    console.log(`--- Pump ${p.id} | ${p.label} (${p.nozzle_label}) | ${p.fuel_type}${p.active ? '' : ' [inactive]'} ---`);

    const rows = await knex('pump_readings as pr')
      .join('shifts as s', 'pr.shift_id', 's.id')
      .where('pr.pump_id', p.id)
      .where('s.status', 'closed')
      .orderByRaw("datetime(COALESCE(s.end_time, s.shift_date || ' 23:59:59')) ASC")
      .orderBy('s.id', 'asc')
      .select(
        'pr.id as reading_id', 'pr.shift_id',
        'pr.opening_litres', 'pr.closing_litres',
        'pr.opening_amount', 'pr.closing_amount',
        'pr.litres_sold', 'pr.amount_sold',
        's.shift_date', 's.end_time'
      );

    if (rows.length === 0) {
      console.log('  (no closed shifts)\n');
      continue;
    }

    let prev = null;
    let monotonicOK = true;
    let derivedOK = true;
    let continuityOK = true;
    let crossings = 0;

    for (const r of rows) {
      const oL = Number(r.opening_litres), cL = Number(r.closing_litres);
      const oA = Number(r.opening_amount), cA = Number(r.closing_amount);
      const lS = Number(r.litres_sold), aS = Number(r.amount_sold);

      // (a) monotonic per row
      if (cL < oL) {
        err(`shift ${r.shift_id}: closing_litres ${fmt(cL)} < opening_litres ${fmt(oL)}`);
        monotonicOK = false;
      }
      if (cA < oA) {
        err(`shift ${r.shift_id}: closing_amount ${fmt(cA)} < opening_amount ${fmt(oA)}`);
        monotonicOK = false;
      }

      // (b) derived sold values match
      if (round2(cL - oL) !== round2(lS)) {
        err(`shift ${r.shift_id}: litres_sold ${fmt(lS)} != closing-opening ${fmt(cL - oL)}`);
        derivedOK = false;
      }
      if (round2(cA - oA) !== round2(aS)) {
        err(`shift ${r.shift_id}: amount_sold ${fmt(aS)} != closing-opening ${fmt(cA - oA)}`);
        derivedOK = false;
      }

      // (c) continuity vs previous closed shift
      if (prev) {
        if (round2(oL) !== round2(Number(prev.closing_litres))) {
          warn(`shift ${r.shift_id}: opening_litres ${fmt(oL)} != prev shift ${prev.shift_id} closing ${fmt(prev.closing_litres)} (gap ${fmt(oL - prev.closing_litres)})`);
          continuityOK = false;
        }
        if (round2(oA) !== round2(Number(prev.closing_amount))) {
          warn(`shift ${r.shift_id}: opening_amount ${fmt(oA)} != prev shift ${prev.shift_id} closing ${fmt(prev.closing_amount)} (gap ${fmt(oA - prev.closing_amount)})`);
          continuityOK = false;
        }
      }

      // (d) flag rollover crossings (informational)
      if (Math.floor(cL / ROLLOVER_CAP) > Math.floor(oL / ROLLOVER_CAP) ||
          Math.floor(cA / ROLLOVER_CAP) > Math.floor(oA / ROLLOVER_CAP)) {
        crossings++;
      }

      prev = r;
    }

    console.log(`  ${rows.length} closed-shift readings`);
    if (monotonicOK)  ok('all readings monotonic (closing >= opening)');
    if (derivedOK)    ok('all litres_sold / amount_sold match closing-opening');
    if (continuityOK) ok('shift-to-shift continuity holds');
    if (crossings)    console.log(`  ℹ ${crossings} shift(s) crossed a 1,000,000 boundary (manual rollover comp recorded)`);

    // near-boundary heads-up: latest reading sitting close to next rollover
    if (prev) {
      const lMod = Number(prev.closing_litres) % ROLLOVER_CAP;
      const aMod = Number(prev.closing_amount) % ROLLOVER_CAP;
      if (lMod >= NEAR_BOUNDARY) console.log(`  ℹ latest closing_litres display ≈ ${fmt(lMod)} — rollover imminent`);
      if (aMod >= NEAR_BOUNDARY) console.log(`  ℹ latest closing_amount display ≈ ${fmt(aMod)} — rollover imminent`);
    }
    console.log('');
  }

  // ------- Top-N largest sold values (typo / anomaly eyeball) -------
  console.log('--- Top largest single-shift sales (eyeball for typos / missed comp) ---');
  const topL = await knex('pump_readings as pr')
    .join('shifts as s', 'pr.shift_id', 's.id')
    .join('pumps as p', 'pr.pump_id', 'p.id')
    .where('s.status', 'closed')
    .orderBy('pr.litres_sold', 'desc')
    .limit(TOP_N)
    .select('pr.shift_id', 'p.label', 'p.fuel_type', 'pr.litres_sold', 'pr.amount_sold', 's.shift_date');

  console.log('  By litres_sold:');
  for (const r of topL) {
    console.log(`    shift ${String(r.shift_id).padStart(4)} ${r.shift_date}  ${r.label.padEnd(8)} ${r.fuel_type.padEnd(8)}  ${fmt(r.litres_sold).padStart(14)} L  /  ${fmt(r.amount_sold).padStart(14)} KES`);
  }

  const topA = await knex('pump_readings as pr')
    .join('shifts as s', 'pr.shift_id', 's.id')
    .join('pumps as p', 'pr.pump_id', 'p.id')
    .where('s.status', 'closed')
    .orderBy('pr.amount_sold', 'desc')
    .limit(TOP_N)
    .select('pr.shift_id', 'p.label', 'p.fuel_type', 'pr.litres_sold', 'pr.amount_sold', 's.shift_date');

  console.log('  By amount_sold:');
  for (const r of topA) {
    console.log(`    shift ${String(r.shift_id).padStart(4)} ${r.shift_date}  ${r.label.padEnd(8)} ${r.fuel_type.padEnd(8)}  ${fmt(r.litres_sold).padStart(14)} L  /  ${fmt(r.amount_sold).padStart(14)} KES`);
  }
  console.log('');

  // ------- Frozen totals (post-migration must match) -------
  console.log('--- Frozen totals (post-migration these must match exactly) ---');
  const totalsByPump = await knex('pump_readings as pr')
    .join('shifts as s', 'pr.shift_id', 's.id')
    .join('pumps as p', 'pr.pump_id', 'p.id')
    .where('s.status', 'closed')
    .groupBy('p.id')
    .select('p.id', 'p.label', 'p.fuel_type')
    .sum({ litres: 'pr.litres_sold', amount: 'pr.amount_sold' })
    .count({ shifts: 'pr.id' });

  console.log('  Per pump:');
  for (const r of totalsByPump) {
    console.log(`    Pump ${r.id} ${r.label.padEnd(8)} ${r.fuel_type.padEnd(8)}  ${fmt(r.litres).padStart(16)} L  /  ${fmt(r.amount).padStart(16)} KES   (${r.shifts} shifts)`);
  }

  const totalsByFuel = await knex('pump_readings as pr')
    .join('shifts as s', 'pr.shift_id', 's.id')
    .join('pumps as p', 'pr.pump_id', 'p.id')
    .where('s.status', 'closed')
    .groupBy('p.fuel_type')
    .select('p.fuel_type')
    .sum({ litres: 'pr.litres_sold', amount: 'pr.amount_sold' });

  console.log('  Per fuel type:');
  for (const r of totalsByFuel) {
    console.log(`    ${r.fuel_type.padEnd(10)}  ${fmt(r.litres).padStart(16)} L  /  ${fmt(r.amount).padStart(16)} KES`);
  }

  const grand = await knex('pump_readings as pr')
    .join('shifts as s', 'pr.shift_id', 's.id')
    .where('s.status', 'closed')
    .sum({ litres: 'pr.litres_sold', amount: 'pr.amount_sold' })
    .first();
  console.log(`  Grand total:  ${fmt(grand.litres).padStart(16)} L  /  ${fmt(grand.amount).padStart(16)} KES\n`);

  console.log(`=== Audit complete: ${errors} error(s), ${warnings} warning(s) ===`);

  await knex.destroy();
  process.exit(errors > 0 ? 1 : 0);
})().catch(async (e) => {
  console.error('AUDIT FAILED:', e);
  try { await knex.destroy(); } catch {}
  process.exit(2);
});
