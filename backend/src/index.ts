import 'dotenv/config';
import express from 'express';
import cors, { CorsOptionsDelegate } from 'cors';
import path from 'path';
import db from './database';
import { getBackupsDir, getDatabasePath, getMobileDistDir } from './runtimePaths';
import { writeAuditLog } from './services/auditLog';
import { recomputeAllDipsFromDate } from './services/stockCalculator';
import { recomputeAllAccountBalances } from './services/accountBalance';
import { detectDrift } from './services/driftDetector';
import { assertAuthConfiguration, requireAdmin, requireAuth } from './middleware/requireAdmin';
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
import customerInvoicesRouter from './routes/customerInvoices';
import mpesaConfigRouter from './routes/mpesaConfig';
import suppliersRouter from './routes/suppliers';
import supplierInvoicesRouter from './routes/supplierInvoices';
import supplierPaymentsRouter from './routes/supplierPayments';

const app = express();
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || (IS_PRODUCTION ? '127.0.0.1' : '0.0.0.0');
const CONFIGURED_CORS_ORIGINS = new Set(
  (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);

const SENSITIVE_BODY_KEYS = [
  'pin',
  'password',
  'token',
  'authorization',
  'secret',
  'session_secret',
  'desktop_key',
  'x-desktop-key',
];

function isPrivateLanHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  );
}

function isAllowedDevOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return isPrivateLanHost(url.hostname);
  } catch {
    return false;
  }
}

function redactSensitiveValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveValues);
  if (!value || typeof value !== 'object') return value;

  const redacted: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    const lowerKey = key.toLowerCase();
    redacted[key] = SENSITIVE_BODY_KEYS.some((sensitiveKey) => lowerKey.includes(sensitiveKey))
      ? '[REDACTED]'
      : redactSensitiveValues(nestedValue);
  }
  return redacted;
}

const corsOptionsDelegate: CorsOptionsDelegate = (req, callback) => {
  const originHeader = req.headers.origin;
  const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
  const allowed =
    !origin ||
    origin === 'null' ||
    origin.startsWith('file://') ||
    CONFIGURED_CORS_ORIGINS.has(origin) ||
    (!IS_PRODUCTION && isAllowedDevOrigin(origin));

  callback(null, {
    origin: allowed && origin ? origin : false,
    allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning', 'x-desktop-key'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    optionsSuccessStatus: 204,
  });
};

app.use(cors(corsOptionsDelegate));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '12mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 400 ? 'ERROR' : 'INFO';
    console.log(`[API:${level}] ${req.method} ${req.path} -> ${res.statusCode} (${ms}ms)`);
    if (res.statusCode >= 400 && req.body && Object.keys(req.body).length) {
      console.log('[API:BODY]', JSON.stringify(redactSensitiveValues(req.body)));
    }
  });
  next();
});

app.use('/api/auth', authRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/health/db-stats', requireAdmin, async (_req, res) => {
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
      'supplier_payment_allocations',
      'tank_stock_adjustments', 'tank_adjustment_batches', 'tank_adjustment_batch_effects',
    ];
    const stats: Record<string, any> = {};
    for (const t of tables) {
      try {
        const total = await db(t).count('* as c').first();
        const row: any = { total: Number(total?.c || 0) };
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

app.get('/api/health/drift-check', requireAdmin, async (_req, res) => {
  try {
    const report = await detectDrift();
    res.json({ success: true, ...report });
  } catch (err: any) {
    console.error('[health:drift-check] ERROR', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/health/backup', requireAdmin, async (_req, res) => {
  try {
    const fs = await import('fs');
    const src = getDatabasePath();
    const dir = getBackupsDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    await db.raw('PRAGMA wal_checkpoint(TRUNCATE)');

    const now = new Date().toLocaleString('sv-SE', { timeZone: 'Africa/Nairobi' })
      .replace(/[-: ]/g, '').slice(0, 14);
    const dest = path.join(dir, `nexgen-${now}.db`);
    fs.copyFileSync(src, dest);
    const { size } = fs.statSync(dest);
    await writeAuditLog(_req, {
      action: 'backup.created',
      target_type: 'backup',
      target_id: path.basename(dest),
      details: { file: path.basename(dest), size_bytes: size },
    });
    res.json({ success: true, file: path.basename(dest), size_bytes: size });
  } catch (err: any) {
    console.error('[health:backup] ERROR', err.message);
    await writeAuditLog(_req, {
      action: 'backup.failed',
      target_type: 'backup',
      details: { error: err.message },
    });
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/health/phase1-backfill', requireAdmin, async (_req, res) => {
  try {
    const dipsUpdated = await recomputeAllDipsFromDate('1900-01-01');
    const acctsUpdated = await recomputeAllAccountBalances();
    res.json({ success: true, dips_recomputed: dipsUpdated, accounts_recomputed: acctsUpdated });
  } catch (err: any) {
    console.error('[health:phase1-backfill] ERROR', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.use('/api', requireAuth);
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
app.use('/api/customer-invoices', customerInvoicesRouter);
app.use('/api/mpesa-config', mpesaConfigRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api/supplier-invoices', supplierInvoicesRouter);
app.use('/api/supplier-payments', supplierPaymentsRouter);

const mobileDist = getMobileDistDir();
app.use('/mobile', express.static(mobileDist));
app.get('/mobile/*', (_req, res) => {
  res.sendFile(path.join(mobileDist, 'index.html'));
});

async function start() {
  assertAuthConfiguration();

  await db.migrate.latest();
  await db.raw('PRAGMA journal_mode = WAL');
  await db.raw('PRAGMA busy_timeout = 5000');
  console.log('Database migrations complete');

  app.listen(PORT, HOST, () => {
    console.log(`NexGen API running on http://${HOST}:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
