import path from 'path';
import fs from 'fs';

export function getDataDirectory(): string {
  const configured = process.env.NEXGEN_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(__dirname, '..', '..', 'data');
}

export function ensureDataDirectory(): string {
  const directory = getDataDirectory();
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}
