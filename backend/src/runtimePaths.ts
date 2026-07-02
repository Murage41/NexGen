import path from 'path';

export function getBackendRoot(): string {
  return path.join(__dirname, '..');
}

export function getDataDir(): string {
  return path.resolve(process.env.NEXGEN_DATA_DIR || path.join(getBackendRoot(), 'data'));
}

export function getDatabasePath(): string {
  return path.join(getDataDir(), 'nexgen.db');
}

export function getBackupsDir(): string {
  return path.join(getDataDir(), 'backups');
}

export function isCompiledRuntime(): boolean {
  return path.basename(__dirname) === 'dist';
}

export function getMigrationsDir(): string {
  if (process.env.NEXGEN_MIGRATIONS_DIR) {
    return path.resolve(process.env.NEXGEN_MIGRATIONS_DIR);
  }

  return isCompiledRuntime()
    ? path.join(__dirname, 'migrations')
    : path.join(getBackendRoot(), 'migrations');
}

export function getMigrationExtension(): string {
  return isCompiledRuntime() ? 'js' : 'ts';
}

export function getMobileDistDir(): string {
  return path.resolve(
    process.env.NEXGEN_MOBILE_DIST ||
      path.join(getBackendRoot(), '..', 'mobile', 'dist'),
  );
}
