import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('../providers/index.js', () => ({
  getProviderAdapter: vi.fn(),
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
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { getProviderAdapter } from '../providers/index.js';
import {
  checkHealth,
  checkAllHealth,
  executeRollback,
  loadObservabilityConfig,
  runMonitorCycle,
  type HealthEndpoint,
  type ObservabilityConfig,
} from './monitor.js';

const mockExeca = vi.mocked(execa);
const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockGetProviderAdapter = vi.mocked(getProviderAdapter);

// ── Shared fixtures ───────────────────────────────────────────────────────────

function makeEndpoint(overrides: Partial<HealthEndpoint> = {}): HealthEndpoint {
  return {
    name: 'api',
    url: 'https://api.example.com/health',
    expected_status: 200,
    timeout_ms: 5000,
    ...overrides,
  };
}

function makeObsConfig(overrides: Partial<ObservabilityConfig> = {}): ObservabilityConfig {
  return {
    health_endpoints: [makeEndpoint()],
    log_command: '',
    rollback_command: 'railway rollback',
    monitor_interval_seconds: 60,
    max_failures_before_rollback: 3,
    ...overrides,
  };
}

function makeOasisConfig() {
  return {
    vault: '/vault',
    platform: 'darwin',
    providers: { default: 'claude' },
    tools: {},
    review: { default_model: 'opus', auto_review: true },
    scheduler: { enabled: false, interval_minutes: 5, method: 'launchd' as const },
    skills: { common: [], auto_generate: false },
  };
}

const mockProvider = {
  name: 'mock',
  isAvailable: vi.fn().mockResolvedValue(true),
  getVersion: vi.fn().mockResolvedValue('1.0'),
  execute: vi.fn().mockResolvedValue({ stdout: 'triage report', stderr: '', exitCode: 0 }),
  review: vi.fn(),
};

// ── checkHealth() ─────────────────────────────────────────────────────────────

describe('checkHealth()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns healthy=true when curl returns expected status', async () => {
    mockExeca.mockResolvedValueOnce({ stdout: '200' } as any);

    const result = await checkHealth(makeEndpoint());

    expect(result.healthy).toBe(true);
    expect(result.status).toBe(200);
    expect(result.error).toBeUndefined();
  });

  it('returns healthy=false when status does not match expected', async () => {
    mockExeca.mockResolvedValueOnce({ stdout: '503' } as any);

    const result = await checkHealth(makeEndpoint({ expected_status: 200 }));

    expect(result.healthy).toBe(false);
    expect(result.status).toBe(503);
  });

  it('returns healthy=false with error message on timeout/network error', async () => {
    mockExeca.mockRejectedValueOnce(new Error('connection refused'));

    const result = await checkHealth(makeEndpoint());

    expect(result.healthy).toBe(false);
    expect(result.error).toBe('connection refused');
    expect(result.status).toBeUndefined();
  });

  it('uses default expected_status=200 when not specified', async () => {
    mockExeca.mockResolvedValueOnce({ stdout: '200' } as any);

    const endpoint = makeEndpoint({ expected_status: undefined });
    const result = await checkHealth(endpoint);

    expect(result.healthy).toBe(true);
  });

  it('uses custom timeout_ms in curl --max-time flag', async () => {
    mockExeca.mockResolvedValueOnce({ stdout: '200' } as any);

    await checkHealth(makeEndpoint({ timeout_ms: 10000 }));

    const curlArgs = mockExeca.mock.calls[0][1] as string[];
    const maxTimeIndex = curlArgs.indexOf('--max-time');
    expect(maxTimeIndex).toBeGreaterThan(-1);
    // ceil(10000 / 1000) = 10
    expect(curlArgs[maxTimeIndex + 1]).toBe('10');
  });
});

// ── checkAllHealth() ──────────────────────────────────────────────────────────

describe('checkAllHealth()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs all checks in parallel using Promise.all', async () => {
    const endpoints = [
      makeEndpoint({ name: 'api', url: 'https://api.example.com/health' }),
      makeEndpoint({ name: 'db', url: 'https://db.example.com/health' }),
    ];

    // Both return 200
    mockExeca
      .mockResolvedValueOnce({ stdout: '200' } as any)
      .mockResolvedValueOnce({ stdout: '200' } as any);

    const results = await checkAllHealth(endpoints);

    expect(results).toHaveLength(2);
    expect(mockExeca).toHaveBeenCalledTimes(2);
  });

  it('returns mixed healthy and unhealthy results', async () => {
    const endpoints = [
      makeEndpoint({ name: 'api', url: 'https://api.example.com/health' }),
      makeEndpoint({ name: 'db', url: 'https://db.example.com/health', expected_status: 200 }),
    ];

    mockExeca
      .mockResolvedValueOnce({ stdout: '200' } as any)
      .mockRejectedValueOnce(new Error('connection refused'));

    const results = await checkAllHealth(endpoints);

    expect(results[0].healthy).toBe(true);
    expect(results[1].healthy).toBe(false);
    expect(results[1].error).toBe('connection refused');
  });
});

// ── executeRollback() ─────────────────────────────────────────────────────────

describe('executeRollback()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true on successful rollback', async () => {
    mockExeca.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any);

    const result = await executeRollback('railway rollback', '/project');

    expect(result).toBe(true);
    expect(mockExeca).toHaveBeenCalledWith('railway', ['rollback'], expect.objectContaining({ cwd: '/project' }));
  });

  it('returns false on failed rollback', async () => {
    mockExeca.mockRejectedValueOnce(new Error('rollback command failed'));

    const result = await executeRollback('railway rollback', '/project');

    expect(result).toBe(false);
  });
});

// ── loadObservabilityConfig() ─────────────────────────────────────────────────

describe('loadObservabilityConfig()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns config when project.yaml has observability section', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(`
observability:
  health_endpoints:
    - name: api
      url: https://api.example.com/health
      expected_status: 200
  log_command: "railway logs --tail 50"
  rollback_command: "railway rollback"
  monitor_interval_seconds: 30
  max_failures_before_rollback: 2
` as any);

    const result = loadObservabilityConfig('/vault', 'my-project');

    expect(result).not.toBeNull();
    expect(result!.health_endpoints).toHaveLength(1);
    expect(result!.health_endpoints[0].name).toBe('api');
    expect(result!.log_command).toBe('railway logs --tail 50');
    expect(result!.rollback_command).toBe('railway rollback');
    expect(result!.monitor_interval_seconds).toBe(30);
    expect(result!.max_failures_before_rollback).toBe(2);
  });

  it('returns null when project.yaml does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    const result = loadObservabilityConfig('/vault', 'my-project');

    expect(result).toBeNull();
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it('returns null when no health_endpoints configured', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(`
observability:
  health_endpoints: []
  rollback_command: "railway rollback"
` as any);

    const result = loadObservabilityConfig('/vault', 'my-project');

    expect(result).toBeNull();
  });

  it('uses default values for optional fields', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(`
observability:
  health_endpoints:
    - name: api
      url: https://api.example.com/health
` as any);

    const result = loadObservabilityConfig('/vault', 'my-project');

    expect(result).not.toBeNull();
    expect(result!.monitor_interval_seconds).toBe(60);
    expect(result!.max_failures_before_rollback).toBe(3);
  });
});

// ── runMonitorCycle() ─────────────────────────────────────────────────────────

describe('runMonitorCycle()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProviderAdapter.mockReturnValue(mockProvider as any);
    mockExistsSync.mockReturnValue(false);
  });

  it('returns action=ok and resets consecutiveFailures to 0 when all healthy', async () => {
    // One endpoint, healthy
    mockExeca.mockResolvedValueOnce({ stdout: '200' } as any);

    const result = await runMonitorCycle(
      'my-project',
      makeObsConfig(),
      makeOasisConfig() as any,
      5,
      '/project',
    );

    expect(result.action).toBe('ok');
    expect(result.consecutiveFailures).toBe(0);
    expect(result.allHealthy).toBe(true);
  });

  it('returns action=triage on first failure (consecutiveFailures=0 → 1)', async () => {
    // Health check fails
    mockExeca.mockRejectedValueOnce(new Error('connection refused'));
    // autoTriage → provider.execute (provider.isAvailable returns true, execute is mocked)

    const result = await runMonitorCycle(
      'my-project',
      makeObsConfig({ rollback_command: '' }),
      makeOasisConfig() as any,
      0,
      '/project',
    );

    expect(result.action).toBe('triage');
    expect(result.consecutiveFailures).toBe(1);
    expect(result.allHealthy).toBe(false);
  });

  it('returns action=warning on consecutive failures below rollback threshold', async () => {
    // Health check fails (2nd failure)
    mockExeca.mockRejectedValueOnce(new Error('connection refused'));

    const result = await runMonitorCycle(
      'my-project',
      makeObsConfig({ max_failures_before_rollback: 3 }),
      makeOasisConfig() as any,
      1, // already had 1 failure, this is the 2nd
      '/project',
    );

    expect(result.action).toBe('warning');
    expect(result.consecutiveFailures).toBe(2);
  });

  it('returns action=rollback when failures reach max_failures_before_rollback', async () => {
    // Health check fails
    mockExeca.mockRejectedValueOnce(new Error('connection refused'));
    // executeRollback call
    mockExeca.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any);

    const result = await runMonitorCycle(
      'my-project',
      makeObsConfig({ max_failures_before_rollback: 3, rollback_command: 'railway rollback' }),
      makeOasisConfig() as any,
      2, // already at 2, this makes it 3 which equals max
      '/project',
    );

    expect(result.action).toBe('rollback');
    expect(result.consecutiveFailures).toBe(3);
  });

  it('calls executeRollback when circuit breaker triggers', async () => {
    // Health check fails
    mockExeca.mockRejectedValueOnce(new Error('service down'));
    // executeRollback
    mockExeca.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any);

    await runMonitorCycle(
      'my-project',
      makeObsConfig({ max_failures_before_rollback: 2, rollback_command: 'railway rollback' }),
      makeOasisConfig() as any,
      1, // 1 + 1 = 2 which equals max
      '/project',
    );

    // The second execa call should be the rollback command
    expect(mockExeca).toHaveBeenCalledWith(
      'railway',
      ['rollback'],
      expect.objectContaining({ cwd: '/project' }),
    );
  });

  it('calls autoTriage when circuit breaker triggers', async () => {
    // Health check fails
    mockExeca.mockRejectedValueOnce(new Error('service down'));
    // executeRollback
    mockExeca.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any);

    await runMonitorCycle(
      'my-project',
      makeObsConfig({ max_failures_before_rollback: 2, rollback_command: 'railway rollback' }),
      makeOasisConfig() as any,
      1,
      '/project',
    );

    expect(mockGetProviderAdapter).toHaveBeenCalledWith('claude');
    expect(mockProvider.isAvailable).toHaveBeenCalled();
  });
});
