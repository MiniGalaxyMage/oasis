import { homedir } from 'node:os';
import {
  getPlatform,
  getOasisConfigDir,
  getConfigPath,
  getDefaultVaultPath,
  expandHome,
  type Platform,
} from './platform.js';

describe('getPlatform', () => {
  it('returns a valid Platform type', () => {
    const valid: Platform[] = ['darwin', 'win32', 'linux'];
    const result = getPlatform();
    expect(valid).toContain(result);
  });
});

describe('getOasisConfigDir', () => {
  it('includes .oasis on non-win32 platforms', () => {
    // On CI or dev machines (darwin/linux) this must include .oasis
    const platform = getPlatform();
    if (platform !== 'win32') {
      expect(getOasisConfigDir()).toContain('.oasis');
    }
  });
});

describe('getConfigPath', () => {
  it('ends with config.yaml', () => {
    expect(getConfigPath()).toMatch(/config\.yaml$/);
  });
});

describe('getDefaultVaultPath', () => {
  it('includes oasis-vault', () => {
    expect(getDefaultVaultPath()).toContain('oasis-vault');
  });
});

describe('expandHome', () => {
  it('replaces ~ with homedir for ~/foo', () => {
    const result = expandHome('~/foo');
    expect(result).toBe(`${homedir()}/foo`);
    expect(result).not.toContain('~');
  });

  it('leaves absolute paths unchanged', () => {
    const abs = '/abs/path/to/something';
    expect(expandHome(abs)).toBe(abs);
  });

  it('leaves relative paths unchanged', () => {
    const rel = 'relative/path';
    expect(expandHome(rel)).toBe(rel);
  });
});
