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

const mockAdapters = new Map<string, { isAvailable: ReturnType<typeof vi.fn>; getVersion: ReturnType<typeof vi.fn> }>();

vi.mock('../providers/index.js', () => ({
  listProviders: vi.fn(() => Array.from(mockAdapters.keys())),
  getProviderAdapter: vi.fn((name: string) => {
    const adapter = mockAdapters.get(name);
    if (!adapter) throw new Error(`Unknown provider: ${name}`);
    return adapter;
  }),
}));

import { execa } from 'execa';
import { confirm } from '@inquirer/prompts';
import {
  checkDependency,
  checkAllDependencies,
  checkAIProviders,
  getAvailableProviders,
  installMissing,
  type Dependency,
  type DependencyStatus,
} from './dependencies.js';

function setProviders(providers: Record<string, { available: boolean; version?: string }>): void {
  mockAdapters.clear();
  for (const [name, { available, version }] of Object.entries(providers)) {
    mockAdapters.set(name, {
      isAvailable: vi.fn().mockResolvedValue(available),
      getVersion: vi.fn().mockResolvedValue(version ?? 'unknown'),
    });
  }
}

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

describe('checkAIProviders()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns one status per registered provider', async () => {
    setProviders({
      claude: { available: true, version: 'claude 1.0' },
      codex: { available: false },
      minimax: { available: true, version: 'minimax adapter' },
    });

    const results = await checkAIProviders();

    expect(results).toHaveLength(3);
    expect(results.map(r => r.name).sort()).toEqual(['claude', 'codex', 'minimax']);
  });

  it('marks all results with type ai-provider', async () => {
    setProviders({
      claude: { available: true },
      minimax: { available: false },
    });

    const results = await checkAIProviders();

    for (const r of results) {
      expect(r.type).toBe('ai-provider');
    }
  });

  it('captures version only when available', async () => {
    setProviders({
      claude: { available: true, version: '1.2.3' },
      codex: { available: false },
    });

    const results = await checkAIProviders();
    const claude = results.find(r => r.name === 'claude');
    const codex = results.find(r => r.name === 'codex');

    expect(claude?.installed).toBe(true);
    expect(claude?.version).toBe('1.2.3');
    expect(codex?.installed).toBe(false);
    expect(codex?.version).toBeUndefined();
  });

  it('handles adapter throwing as not installed', async () => {
    mockAdapters.clear();
    mockAdapters.set('broken', {
      isAvailable: vi.fn().mockRejectedValue(new Error('boom')),
      getVersion: vi.fn(),
    });

    const results = await checkAIProviders();

    expect(results).toHaveLength(1);
    expect(results[0].installed).toBe(false);
  });
});

describe('checkAllDependencies()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setProviders({
      claude: { available: true, version: '1.0' },
      codex: { available: false },
      minimax: { available: true, version: 'minimax' },
    });
  });

  it('combines system/mcp deps with AI providers', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: '1.0.0' } as any);

    const results = await checkAllDependencies();

    // 3 system/mcp (git, engram, context7) + 3 providers from setProviders above
    expect(results.length).toBe(6);

    const providerResults = results.filter(r => r.type === 'ai-provider');
    expect(providerResults).toHaveLength(3);
    expect(providerResults.map(r => r.name).sort()).toEqual(['claude', 'codex', 'minimax']);
  });

  it('includes both installed and missing entries', async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce({ stdout: 'git version 2.40.0' } as any) // git
      .mockRejectedValue(new Error('not found'));                       // rest of deps

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
