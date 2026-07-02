import db from '../database';

export function normalizeUsername(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function usernameBase(name: string, fallback: string): string {
  const base = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 40);
  return base || fallback;
}

async function uniqueUsername(base: string, excludeUserId?: number): Promise<string> {
  let candidate = base;
  let suffix = 2;

  while (true) {
    const query = db('app_users').where({ username: candidate });
    if (excludeUserId) query.whereNot({ id: excludeUserId });
    const existing = await query.first();
    if (!existing) return candidate;
    candidate = `${base}.${suffix}`;
    suffix += 1;
  }
}

export async function ensureEmployeeLoginUser(employee: any): Promise<any> {
  if (!employee?.id) return null;

  const existing = await db('app_users').where({ employee_id: employee.id }).first();
  const username = existing?.username ||
    (await uniqueUsername(usernameBase(employee.name, `employee.${employee.id}`), existing?.id));
  const payload = {
    username,
    display_name: employee.name,
    pin: employee.pin || existing?.pin || '0000',
    role: employee.role || 'attendant',
    employee_id: employee.id,
    active: employee.active !== false && employee.active !== 0,
    updated_at: db.fn.now(),
  };

  if (existing) {
    await db('app_users').where({ id: existing.id }).update(payload);
    return db('app_users').where({ id: existing.id }).first();
  }

  const [id] = await db('app_users').insert(payload);
  return db('app_users').where({ id }).first();
}
