import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

vi.mock('@inquirer/prompts', () => ({
  confirm: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    step: vi.fn(),
    dim: vi.fn(),
    header: vi.fn(),
  },
}));

import { execa } from 'execa';
import { confirm } from '@inquirer/prompts';
import {
  checkDependency,
  checkAllDependencies,
  getAvailableProviders,
  installMissing,
  type Dependency,
  type DependencyStatus,
} from './dependencies.js';

describe('getAvailableProviders()', () => {
  it('filters only installed ai-providers', () => {
    const statuses: DependencyStatus[] = [
      { name: 'git', installed: true, version: '2.40.0', type: 'system' },
      { name: 'engram', installed: true, version: '1.0.0', type: 'mcp' },
      { name: 'claude', installed: true, version: '1.2.3', type: 'ai-provider' },
      { name: 'codex', installed: false, type: 'ai-provider' },
    ];

    const result = getAvailableProviders(statuses);
    expect(result).toEqual(['claude']);
  });

  it('returns empty array when no ai-providers are installed', () => {
    const statuses: DependencyStatus[] = [
      { name: 'git', installed: true, version: '2.40.0', type: 'system' },
      { name: 'claude', installed: false, type: 'ai-provider' },
      { name: 'codex', installed: false, type: 'ai-provider' },
    ];

    const result = getAvailableProviders(statuses);
    expect(result).toEqual([]);
  });
});

describe('checkDependency()', () => {
  const baseDep: Dependency = {
    name: 'git',
    checkCommand: ['git', '--version'],
    required: true,
    type: 'system',
  };

  beforeEach(() => vi.clearAllMocks());

  it('returns installed=true with version when command succeeds', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: 'git version 2.40.1' } as any);

    const result = await checkDependency(baseDep);

    expect(result.installed).toBe(true);
    expect(result.name).toBe('git');
    expect(result.type).toBe('system');
  });

  it('extracts semver version from stdout', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: 'git version 2.40.1' } as any);

    const result = await checkDependency(baseDep);
    expect(result.version).toBe('2.40.1');
  });

  it('falls back to "found" when stdout has no semver', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: 'some tool' } as any);

    const result = await checkDependency(baseDep);
    expect(result.version).toBe('found');
  });

  it('returns installed=false when command fails', async () => {
    vi.mocked(execa).mockRejectedValue(new Error('command not found'));

    const result = await checkDependency(baseDep);

    expect(result.installed).toBe(false);
    expect(result.version).toBeUndefined();
  });

  it('calls execa with the correct command and timeout', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: '1.0.0' } as any);

    await checkDependency(baseDep);

    expect(execa).toHaveBeenCalledWith('git', ['--version'], { timeout: 10_000 });
  });
});

describe('checkAllDependencies()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a status for every dependency', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: '1.0.0' } as any);

    const results = await checkAllDependencies();

    // git, engram, context7, claude, codex — 5 defined deps
    expect(results.length).toBeGreaterThanOrEqual(5);
    for (const r of results) {
      expect(r).toHaveProperty('name');
      expect(r).toHaveProperty('installed');
      expect(r).toHaveProperty('type');
    }
  });

  it('includes both installed and missing deps', async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce({ stdout: 'git version 2.40.0' } as any) // git
      .mockRejectedValue(new Error('not found'));                       // rest

    const results = await checkAllDependencies();
    const installed = results.filter(r => r.installed);
    const missing = results.filter(r => !r.installed);

    expect(installed.length).toBeGreaterThanOrEqual(1);
    expect(missing.length).toBeGreaterThanOrEqual(1);
  });
});

describe('installMissing()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls process.exit(1) when a required dependency is missing', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    const statuses: DependencyStatus[] = [
      { name: 'git', installed: false, type: 'system' },
    ];

    await installMissing(statuses);

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('prompts for optional installable dependencies', async () => {
    vi.mocked(confirm).mockResolvedValue(false);
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as any);

    const statuses: DependencyStatus[] = [
      // engram is optional and has an installCommand
      { name: 'engram', installed: false, type: 'mcp' },
    ];

    await installMissing(statuses);

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Engram') }),
    );
  });

  it('runs the install command when user confirms', async () => {
    vi.mocked(confirm).mockResolvedValue(true);
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as any);

    const statuses: DependencyStatus[] = [
      { name: 'engram', installed: false, type: 'mcp' },
    ];

    await installMissing(statuses);

    expect(execa).toHaveBeenCalledWith(
      'npm',
      ['install', '-g', 'engram-mcp'],
      expect.objectContaining({ stdio: 'inherit' }),
    );
  });

  it('handles install failure gracefully (execa throws)', async () => {
    vi.mocked(confirm).mockResolvedValue(true);
    vi.mocked(execa).mockRejectedValue(new Error('npm ERR! network timeout'));

    const statuses: DependencyStatus[] = [
      { name: 'engram', installed: false, type: 'mcp' },
    ];

    // Should not throw
    await expect(installMissing(statuses)).resolves.toBeUndefined();
  });

  it('does not prompt when user declines and does not install', async () => {
    vi.mocked(confirm).mockResolvedValue(false);

    const statuses: DependencyStatus[] = [
      { name: 'engram', installed: false, type: 'mcp' },
    ];

    await installMissing(statuses);

    expect(execa).not.toHaveBeenCalled();
  });

  it('does nothing when all dependencies are installed', async () => {
    const statuses: DependencyStatus[] = [
      { name: 'git', installed: true, version: '2.40.0', type: 'system' },
    ];

    await installMissing(statuses);

    expect(confirm).not.toHaveBeenCalled();
    expect(execa).not.toHaveBeenCalled();
  });
});
