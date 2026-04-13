import { describe, it, expect, vi, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { OasisConfig } from '../../src/core/config.js';

const tempConfigDir = mkdtempSync(join(tmpdir(), 'oasis-config-'));

vi.mock('../../src/utils/platform.js', () => ({
  getConfigPath: () => join(tempConfigDir, 'config.yaml'),
  getOasisConfigDir: () => tempConfigDir,
}));

const { saveConfig, loadConfig, configExists } = await import('../../src/core/config.js');

afterAll(() => {
  rmSync(tempConfigDir, { recursive: true, force: true });
});

describe('Config Integration', () => {
  const sampleConfig: OasisConfig = {
    vault: '/tmp/test-vault',
    platform: 'darwin',
    providers: {
      default: 'claude',
      claude: { command: 'claude', available: true },
    },
    tools: {
      engram: { installed: true, type: 'mcp' },
    },
    review: { default_model: 'opus', auto_review: true },
    scheduler: { enabled: true, interval_minutes: 30, method: 'launchd' },
    skills: { common: ['typescript'], auto_generate: true },
  };

  it('save and load config roundtrip preserves all fields', () => {
    saveConfig(sampleConfig);
    expect(configExists()).toBe(true);

    const loaded = loadConfig();
    expect(loaded.vault).toBe('/tmp/test-vault');
    expect(loaded.platform).toBe('darwin');
    expect(loaded.providers.default).toBe('claude');
    expect(loaded.review.default_model).toBe('opus');
    expect(loaded.review.auto_review).toBe(true);
    expect(loaded.scheduler.enabled).toBe(true);
    expect(loaded.scheduler.interval_minutes).toBe(30);
    expect(loaded.scheduler.method).toBe('launchd');
    expect(loaded.skills.common).toContain('typescript');
    expect(loaded.skills.auto_generate).toBe(true);
  });
});
