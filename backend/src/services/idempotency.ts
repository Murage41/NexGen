import { createHash } from 'crypto';
import type { Knex } from 'knex';

type StoredRecord = {
  request_hash: string;
  response_status: number | null;
  response_body: string | null;
};

type OperationResult<T> = {
  status: number;
  body: T;
};

export type IdempotentResult<T> = OperationResult<T> & {
  replayed: boolean;
};

function httpError(message: string, status: number, code: string) {
  return Object.assign(new Error(message), { httpStatus: status, http: status, code });
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function requestHash(payload: unknown) {
  return createHash('sha256').update(JSON.stringify(stableValue(payload))).digest('hex');
}

function replay<T>(record: StoredRecord, hash: string): IdempotentResult<T> {
  if (record.request_hash !== hash) {
    throw httpError(
      'This operation key was already used for different data. Refresh and submit again.',
      409,
      'IDEMPOTENCY_KEY_REUSED',
    );
  }
  if (record.response_status === null || record.response_body === null) {
    throw httpError(
      'This operation is still being processed. Wait briefly, then refresh.',
      409,
      'IDEMPOTENCY_OPERATION_IN_PROGRESS',
    );
  }
  return {
    status: Number(record.response_status),
    body: JSON.parse(record.response_body) as T,
    replayed: true,
  };
}

export function normalizeIdempotencyKey(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw httpError('Idempotency-Key must be a string.', 400, 'INVALID_IDEMPOTENCY_KEY');
  }
  const key = value.trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw httpError(
      'Idempotency-Key must be 8-128 characters using letters, numbers, dot, underscore, colon, or hyphen.',
      400,
      'INVALID_IDEMPOTENCY_KEY',
    );
  }
  return key;
}

export async function runIdempotent<T>(
  conn: Knex,
  input: {
    scope: string;
    key?: string;
    payload: unknown;
  },
  operation: (trx: Knex.Transaction) => Promise<OperationResult<T>>,
): Promise<IdempotentResult<T>> {
  if (!input.key) {
    const result = await conn.transaction(operation);
    return { ...result, replayed: false };
  }

  const hash = requestHash(input.payload);
  const existing = await conn('idempotency_records')
    .where({ scope: input.scope, idempotency_key: input.key })
    .first<StoredRecord>();
  if (existing) return replay<T>(existing, hash);

  try {
    return await conn.transaction(async (trx) => {
      await trx('idempotency_records').insert({
        scope: input.scope,
        idempotency_key: input.key,
        request_hash: hash,
      });

      const result = await operation(trx);
      await trx('idempotency_records')
        .where({ scope: input.scope, idempotency_key: input.key })
        .update({
          response_status: result.status,
          response_body: JSON.stringify(result.body),
        });
      return { ...result, replayed: false };
    });
  } catch (err: any) {
    const isDuplicate = err?.code === 'SQLITE_CONSTRAINT'
      || String(err?.message || '').includes('UNIQUE constraint failed: idempotency_records');
    if (!isDuplicate) throw err;

    const winner = await conn('idempotency_records')
      .where({ scope: input.scope, idempotency_key: input.key })
      .first<StoredRecord>();
    if (!winner) throw err;
    return replay<T>(winner, hash);
  }
}
