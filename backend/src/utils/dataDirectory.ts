import path from 'path';

export function getDataDirectory(): string {
  const configured = process.env.NEXGEN_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(__dirname, '..', '..', 'data');
}
