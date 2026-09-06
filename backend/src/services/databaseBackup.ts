import type { Knex } from 'knex';
import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export async function verifiedDatabaseBackup(db: Knex, directory: string) {
  fs.mkdirSync(directory, { recursive: true });
  const filename = `nexgen-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.db`;
  const destination = path.join(directory, filename);
  await db.raw('VACUUM INTO ?', [destination]);
  await new Promise<void>((resolve, reject) => {
    const copy = new sqlite3.Database(
      destination,
      sqlite3.OPEN_READONLY,
      (err) => {
        if (err) return reject(err);
        copy.all('PRAGMA integrity_check', (error, rows: any[]) => {
          if (error || rows.length !== 1 || rows[0].integrity_check !== 'ok') {
            copy.close();
            reject(error || new Error('Backup integrity check failed.'));
            return;
          }
          copy.all(
            'PRAGMA foreign_key_check',
            (foreignKeyError, violations: any[]) => {
              copy.close();
              if (foreignKeyError || violations.length)
                reject(
                  foreignKeyError ||
                    new Error(
                      'Backup contains inconsistent record references.',
                    ),
                );
              else resolve();
            },
          );
        });
      },
    );
  });
  return {
    file: filename,
    path: destination,
    size_bytes: fs.statSync(destination).size,
  };
}
