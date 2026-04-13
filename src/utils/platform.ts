import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export type Platform = 'darwin' | 'win32' | 'linux';

export function getPlatform(): Platform {
  const p = platform();
  if (p === 'darwin' || p === 'win32' || p === 'linux') return p;
  // Fallback for other Unix-like systems
  return 'linux';
}

export function getOasisConfigDir(): string {
  const p = getPlatform();
  if (p === 'win32') {
    return join(process.env['APPDATA'] || join(homedir(), 'AppData', 'Roaming'), 'oasis');
  }
  return join(homedir(), '.oasis');
}

export function getConfigPath(): string {
  return join(getOasisConfigDir(), 'config.yaml');
}

export function getDefaultVaultPath(): string {
  return join(homedir(), 'oasis-vault');
}

export function expandHome(filepath: string): string {
  if (filepath.startsWith('~')) {
    return join(homedir(), filepath.slice(1));
  }
  return filepath;
}
