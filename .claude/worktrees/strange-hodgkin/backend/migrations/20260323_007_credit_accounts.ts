import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // 1. Create credit_accounts table
  if (!(await knex.schema.hasTable('credit_accounts'))) {
    await knex.schema.createTable('credit_accounts', (t) => {
      t.increments('id').primary();
      t.string('name').notNullable();
      t.string('phone').nullable();
      t.string('type').notNullable(); // 'customer' | 'employee'
      t.integer('employee_id').unsigned().nullable().references('id').inTable('employees');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 2. Add account_id to credits
  if (await knex.schema.hasTable('credits')) {
    const hasCol = await knex.schema.hasColumn('credits', 'account_id');
    if (!hasCol) {
      await knex.schema.alterTable('credits', (t) => {
        t.integer('account_id').unsigned().nullable().references('id').inTable('credit_accounts');
      });
    }
  }

  // 3. Add account_id to credit_payments
  if (await knex.schema.hasTable('credit_payments')) {
    const hasCol = await knex.schema.hasColumn('credit_payments', 'account_id');
    if (!hasCol) {
      await knex.schema.alterTable('credit_payments', (t) => {
        t.integer('account_id').unsigned().nullable().references('id').inTable('credit_accounts');
      });
    }
  }

  // 4. Add account_id to invoices (if table exists)
  if (await knex.schema.hasTable('invoices')) {
    const hasCol = await knex.schema.hasColumn('invoices', 'account_id');
    if (!hasCol) {
      await knex.schema.alterTable('invoices', (t) => {
        t.integer('account_id').unsigned().nullable().references('id').inTable('credit_accounts');
      });
    }
  }

  // 5. Data migration — backfill credit_accounts from existing data

  // 5a. Group existing credits with balance > 0 by customer_name (case-insensitive)
  const outstandingCredits: Array<{ customer_name: string; customer_phone: string | null }> =
    await knex('credits')
      .select(knex.raw('LOWER(customer_name) as lower_name'))
      .select('customer_name', 'customer_phone')
      .where('balance', '>', 0)
      .groupByRaw('LOWER(customer_name)')
      .orderByRaw('MIN(id)');

  // 5b. Create a credit_accounts row for each unique customer
  const customerAccountMap = new Map<string, number>();

  for (const row of outstandingCredits) {
    const [inserted] = await knex('credit_accounts')
      .insert({
        name: row.customer_name,
        phone: row.customer_phone,
        type: 'customer',
      })
      .returning('id');

    const accountId = typeof inserted === 'object' ? inserted.id : inserted;
    customerAccountMap.set(row.customer_name.toLowerCase(), accountId);
  }

  // 5c. Backfill account_id on credits rows
  for (const [lowerName, accountId] of customerAccountMap) {
    await knex('credits')
      .whereRaw('LOWER(customer_name) = ?', [lowerName])
      .update({ account_id: accountId });
  }

  // 5d. Backfill account_id on credit_payments via the credit's account
  await knex('credit_payments')
    .update({
      account_id: knex('credits')
        .select('account_id')
        .whereRaw('credits.id = credit_payments.credit_id')
        .limit(1),
    });

  // 5e. For each employee with outstanding staff_debts, create credit_accounts row
  if (await knex.schema.hasTable('staff_debts')) {
    const employeesWithDebts: Array<{ employee_id: number; name: string }> =
      await knex('staff_debts')
        .join('employees', 'employees.id', 'staff_debts.employee_id')
        .where('staff_debts.status', 'outstanding')
        .where('staff_debts.balance', '>', 0)
        .select('employees.id as employee_id', 'employees.name')
        .groupBy('employees.id', 'employees.name');

    for (const emp of employeesWithDebts) {
      await knex('credit_accounts').insert({
        name: emp.name,
        type: 'employee',
        employee_id: emp.employee_id,
      });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  // Remove account_id columns first (reverse order of addition)
  if (await knex.schema.hasTable('invoices')) {
    const hasCol = await knex.schema.hasColumn('invoices', 'account_id');
    if (hasCol) {
      await knex.schema.alterTable('invoices', (t) => {
        t.dropColumn('account_id');
      });
    }
  }

  if (await knex.schema.hasTable('credit_payments')) {
    const hasCol = await knex.schema.hasColumn('credit_payments', 'account_id');
    if (hasCol) {
      await knex.schema.alterTable('credit_payments', (t) => {
        t.dropColumn('account_id');
      });
    }
  }

  if (await knex.schema.hasTable('credits')) {
    const hasCol = await knex.schema.hasColumn('credits', 'account_id');
    if (hasCol) {
      await knex.schema.alterTable('credits', (t) => {
        t.dropColumn('account_id');
      });
    }
  }

  // Drop credit_accounts table
  await knex.schema.dropTableIfExists('credit_accounts');
}
