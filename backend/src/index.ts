import express from 'express';
import cors from 'cors';
import path from 'path';
import db from './database';
import { recomputeAllDipsFromDate } from './services/stockCalculator';
import { recomputeAllAccountBalances } from './services/accountBalance';
import { detectDrift } from './services/driftDetector';
import employeesRouter from './routes/employees';
import pumpsRouter from './routes/pumps';
import tanksRouter from './routes/tanks';
import shiftsRouter from './routes/shifts';
import fuelPricesRouter from './routes/fuelPrices';
import expensesRouter from './routes/expenses';
import creditsRouter from './routes/credits';
import fuelDeliveriesRouter from './routes/fuelDeliveries';
import tankDipsRouter from './routes/tankDips';
import invoicesRouter from './routes/invoices';
import dashboardRouter from './routes/dashboard';
import reportsRouter from './routes/reports';
import authRouter from './routes/auth';
import creditAccountsRouter from './routes/creditAccounts';
import mpesaConfigRouter from './routes/mpesaConfig';
import suppliersRouter from './routes/suppliers';
import supplierInvoicesRouter from './routes/supplierInvoices';
import supplierPaymentsRouter from './routes/supplierPayments';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ── Request logger — prints every API call + status + duration ──────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 400 ? 'ERROR' : 'INFO';
    console.log(`[API:${level}] ${req.method} ${req.path} → ${res.statusCode} (${ms}ms)`);
    if (res.statusCode >= 400 && req.body && Object.keys(req.body).length) {
      console.log(`[API:BODY]`, JSON.stringify(req.body));
    }
  });
  next();
});

// Routes
app.use('/api/auth', authRouter);
app.use('/api/employees', employeesRouter);
app.use('/api/pumps', pumpsRouter);
app.use('/api/tanks', tanksRouter);
app.use('/api/shifts', shiftsRouter);
app.use('/api/fuel-prices', fuelPricesRouter);
app.use('/api/expenses', expensesRouter);
app.use('/api/credits', creditsRouter);
app.use('/api/fuel-deliveries', fuelDeliveriesRouter);
app.use('/api/tank-dips', tankDipsRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/credit-accounts', creditAccountsRouter);
app.use('/api/mpesa-config', mpesaConfigRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api/supplier-invoices', supplierInvoicesRouter);
app.use('/api/supplier-payments', supplierPaymentsRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// DB stats — row counts per table. Used to verify migrations + detect data loss
// after each debug-sweep phase. Compare counts against golden snapshot.
app.get('/api/health/db-stats', async (_req, res) => {
  try {
    const tables = [
      'employees', 'pumps', 'tanks', 'shifts', 'pump_readings',
      'shift_collections', 'shift_expenses', 'shift_credits', 'wage_deductions',
      'fuel_deliveries', 'delivery_batches', 'batch_consumption',
      'tank_dips', 'tank_stock_ledger', 'shift_tank_snapshots',
      'fuel_prices', 'mpesa_fee_config',
      'credits', 'credit_accounts', 'credit_payments',
      'expenses', 'staff_debts',
      'suppliers', 'supplier_invoices', 'supplier_payments',
    ];
    const stats: Record<string, any> = {};
    for (const t of tables) {
      try {
        const total = await db(t).count('* as c').first();
        const row: any = { total: Number(total?.c || 0) };
        // For tables with deleted_at, show active vs deleted breakdown
        const hasDeletedAt = await db.schema.hasColumn(t, 'deleted_at');
        if (hasDeletedAt) {
          const active = await db(t).whereNull('deleted_at').count('* as c').first();
          row.active = Number(active?.c || 0);
          row.deleted = row.total - row.active;
        }
        stats[t] = row;
      } catch (e: any) {
        stats[t] = { error: e.message };
      }
    }
    res.json({ success: true, data: stats, timestamp: new Date().toISOString() });
  } catch (err: any) {
    console.error('[health:db-stats] ERROR', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Drift detector — Phase 1/11 production-readiness debug-sweep.
// Walks every Category C cache, recomputes the truth, and reports any rows
// whose cached value disagrees with truth. Used to detect regressions after
// each phase. Returns ok:true when all caches are in sync.
// Implementation lives in services/driftDetector so the dashboard can
// embed a summary too.
app.get('/api/health/drift-check', async (_req, res) => {
  try {
    const report = await detectDrift();
    res.json({ success: true, ...report });
  } catch (err: any) {
    console.error('[health:drift-check] ERROR', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// One-time backfill — Phase 1. Recomputes all dips' book_stock_at_dip and
// all credit_accounts.balance from source rows. Idempotent: safe to run
// multiple times. Use after the Phase 1 wire-in to clear historical drift.
app.post('/api/health/phase1-backfill', async (_req, res) => {
  try {
    const dipsUpdated = await recomputeAllDipsFromDate('1900-01-01');
    const acctsUpdated = await recomputeAllAccountBalances();
    res.json({ success: true, dips_recomputed: dipsUpdated, accounts_recomputed: acctsUpdated });
  } catch (err: any) {
    console.error('[health:phase1-backfill] ERROR', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Serve mobile app static files
const mobileDist = path.join(__dirname, '../../mobile/dist');
app.use('/mobile', express.static(mobileDist));
app.get('/mobile/*', (_req, res) => {
  res.sendFile(path.join(mobileDist, 'index.html'));
});

async function start() {
  // Run migrations
  await db.migrate.latest();
  console.log('Database migrations complete');

  app.listen(PORT as number, '0.0.0.0', () => {
    console.log(`NexGen API running on http://0.0.0.0:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
