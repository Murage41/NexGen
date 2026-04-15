import express from 'express';
import cors from 'cors';
import path from 'path';
import db from './database';
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
