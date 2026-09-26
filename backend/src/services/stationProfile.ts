import fs from 'fs';
import path from 'path';
import type { Knex } from 'knex';

// The station profile (M8): one record that every document's header and
// footer reads. Its logo replaces the one that ships with NexGen; without one,
// documents and screens use the default (backend/assets/nexgen-logo.png).

type Conn = Knex | Knex.Transaction;

export const DEFAULT_LOGO_PATH = path.resolve(__dirname, '..', '..', 'assets', 'nexgen-logo.png');
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export const PROFILE_FIELDS = [
  'trading_name',
  'registered_name',
  'physical_address',
  'postal_address',
  'phone',
  'email',
  'kra_pin',
  'vat_number',
  'mpesa_details',
  'bank_details',
  'document_footer',
] as const;

export type StationProfile = Record<(typeof PROFILE_FIELDS)[number], string | null> & {
  has_custom_logo: boolean;
  updated_at: string | null;
};

export async function getStationProfile(conn: Conn): Promise<StationProfile> {
  const row = await conn('station_profile').where({ id: 1 }).first();
  const profile: any = { has_custom_logo: Boolean(row?.logo), updated_at: row?.updated_at || null };
  for (const field of PROFILE_FIELDS) profile[field] = row?.[field] ?? null;
  return profile;
}

export async function updateStationProfile(conn: Conn, input: Partial<Record<(typeof PROFILE_FIELDS)[number], string | null>>, actorId?: number | null) {
  const update: Record<string, unknown> = { updated_at: conn.fn.now(), updated_by_employee_id: actorId || null };
  for (const field of PROFILE_FIELDS) if (field in input) update[field] = input[field] ?? null;
  await conn('station_profile').where({ id: 1 }).update(update);
  return getStationProfile(conn);
}

// Only PNG and JPEG: both go straight into a PDF, and neither can carry script.
export function logoMime(buffer: Buffer): 'image/png' | 'image/jpeg' | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  return null;
}

export async function setStationLogo(conn: Conn, buffer: Buffer | null, actorId?: number | null) {
  const mime = buffer ? logoMime(buffer) : null;
  await conn('station_profile').where({ id: 1 }).update({
    logo: buffer,
    logo_mime: mime,
    updated_at: conn.fn.now(),
    updated_by_employee_id: actorId || null,
  });
}

// The logo documents and screens show: the station's own, else the default.
export async function stationLogo(conn: Conn): Promise<{ data: Buffer; mime: string; custom: boolean }> {
  const row = await conn('station_profile').where({ id: 1 }).first('logo', 'logo_mime');
  if (row?.logo) return { data: Buffer.from(row.logo), mime: row.logo_mime || 'image/png', custom: true };
  return { data: fs.readFileSync(DEFAULT_LOGO_PATH), mime: 'image/png', custom: false };
}
