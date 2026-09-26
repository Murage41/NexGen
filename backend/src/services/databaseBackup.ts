import type { Knex } from 'knex';
import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getDataDirectory } from '../utils/dataDirectory';

// Uploaded supplier invoice PDFs are files (routes/fuelDeliveries.ts), so each
// backup copies them beside the database copy. Issued customer documents live
// inside the database (stored_documents) and need nothing extra.
export const UPLOADED_FILES_DIR = path.join(getDataDirectory(), 'invoice-documents');

function countFiles(directory: string): number {
  return fs.readdirSync(directory, { withFileTypes: true })
    .reduce((n, entry) => n + (entry.isDirectory() ? countFiles(path.join(directory, entry.name)) : 1), 0);
}

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
  let filesCopied = 0;
  let filesPath: string | null = null;
  if (fs.existsSync(UPLOADED_FILES_DIR)) {
    filesPath = path.join(directory, filename.replace(/\.db$/, '-files'));
    fs.cpSync(UPLOADED_FILES_DIR, path.join(filesPath, 'invoice-documents'), { recursive: true });
    filesCopied = countFiles(filesPath);
  }
  return {
    file: filename,
    path: destination,
    size_bytes: fs.statSync(destination).size,
    uploaded_files_copied: filesCopied,
    uploaded_files_path: filesPath,
  };
}
