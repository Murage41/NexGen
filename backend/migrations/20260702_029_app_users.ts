import type { Knex } from 'knex';

function usernameBase(name: string, fallback: string): string {
  const base = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 40);
  return base || fallback;
}

async function uniqueUsername(knex: Knex, base: string): Promise<string> {
  let candidate = base;
  let suffix = 2;

  while (await knex('app_users').where({ username: candidate }).first()) {
    candidate = `${base}.${suffix}`;
    suffix += 1;
  }

  return candidate;
}

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('app_users', (t) => {
    t.increments('id').primary();
    t.string('username').notNullable().unique();
    t.string('display_name').notNullable();
    t.string('pin').notNullable();
    t.string('role').notNullable().defaultTo('attendant');
    t.integer('employee_id').unsigned().nullable().references('id').inTable('employees').onDelete('SET NULL');
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamp('last_login_at');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  const employees = await knex('employees')
    .select('id', 'name', 'pin', 'role', 'active')
    .orderBy('id');

  for (const employee of employees) {
    const base = usernameBase(employee.name, `employee.${employee.id}`);
    const username = await uniqueUsername(knex, base);
    await knex('app_users').insert({
      username,
      display_name: employee.name,
      pin: employee.pin || '0000',
      role: employee.role || 'attendant',
      employee_id: employee.id,
      active: employee.active !== false && employee.active !== 0,
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('app_users');
}
