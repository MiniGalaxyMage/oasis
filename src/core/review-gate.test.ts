import { vi, describe, it, expect, beforeEach } from 'vitest';

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

import { getProviderAdapter } from '../providers/index.js';
import {
  getReviewGateConfig,
  runReviewGate,
  type ReviewGateConfig,
} from './review-gate.js';
import type { ReviewResult } from '../providers/adapter.js';

// ── shared mock provider ──────────────────────────────────────────────────────

const mockProvider = {
  name: 'mock',
  isAvailable: vi.fn().mockResolvedValue(true),
  getVersion: vi.fn().mockResolvedValue('1.0'),
  execute: vi.fn(),
  review: vi.fn(),
};

const passingReview: ReviewResult = {
  passed: true,
  feedback: 'Looks good.',
  issues: [],
};

const failingReview: ReviewResult = {
  passed: false,
  feedback: 'Needs work.',
  issues: [{ severity: 'critical', message: 'Missing edge case' }],
};

// ── getReviewGateConfig() ─────────────────────────────────────────────────────

describe('getReviewGateConfig()', () => {
  it('uses defaults when both configs are empty', () => {
    const config = getReviewGateConfig({}, {});

    expect(config.provider).toBe('claude');
    expect(config.model).toBe('opus');
    expect(config.max_retries).toBe(2);
    expect(config.phases).toEqual({
      proposal: 'auto',
      spec: 'auto',
      design: 'human',
      tasks: 'auto',
      apply: 'auto',
      verify: 'auto',
    });
  });

  it('merges project config over global defaults', () => {
    const projectConfig = {
      review: {
        provider: 'codex',
        model: 'o3',
        max_retries: 5,
      },
    };
    const globalConfig = {
      providers: { default: 'claude' },
      review: { default_model: 'sonnet' },
    };

    const config = getReviewGateConfig(projectConfig, globalConfig);

    expect(config.provider).toBe('codex');
    expect(config.model).toBe('o3');
    expect(config.max_retries).toBe(5);
  });

  it('falls back to global provider when project provider is empty', () => {
    const projectConfig = { review: { provider: '' } };
    const globalConfig = { providers: { default: 'codex' } };

    const config = getReviewGateConfig(projectConfig, globalConfig);
    expect(config.provider).toBe('codex');
  });

  it('falls back to global default_model when project model is empty', () => {
    const projectConfig = { review: { model: '' } };
    const globalConfig = { review: { default_model: 'haiku' } };

    const config = getReviewGateConfig(projectConfig, globalConfig);
    expect(config.model).toBe('haiku');
  });

  it('preserves phase-specific overrides (e.g., design: human)', () => {
    const projectConfig = {
      review: {
        phases: {
          proposal: 'skip',
          spec: 'auto',
          design: 'human',
          tasks: 'auto',
          apply: 'human',
          verify: 'skip',
        },
      },
    };

    const config = getReviewGateConfig(projectConfig, {});

    expect(config.phases.proposal).toBe('skip');
    expect(config.phases.design).toBe('human');
    expect(config.phases.apply).toBe('human');
    expect(config.phases.verify).toBe('skip');
  });
});

// ── runReviewGate() ───────────────────────────────────────────────────────────

const baseConfig: ReviewGateConfig = {
  provider: 'mock',
  model: 'opus',
  phases: {
    proposal: 'auto',
    spec: 'auto',
    design: 'human',
    tasks: 'auto',
    apply: 'auto',
    verify: 'auto',
  },
  max_retries: 2,
};

describe('runReviewGate()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProviderAdapter).mockReturnValue(mockProvider as any);
  });

  // ── skip mode ──────────────────────────────────────────────────────────────

  describe('skip mode', () => {
    it('returns passed=true with 0 attempts', async () => {
      const config: ReviewGateConfig = {
        ...baseConfig,
        phases: { ...baseConfig.phases, proposal: 'skip' },
      };

      const result = await runReviewGate('proposal', '/path/artifact.md', '/cwd', config);

      expect(result.passed).toBe(true);
      expect(result.attempts).toBe(0);
      expect(result.escalatedToHuman).toBe(false);
      expect(result.reviews).toHaveLength(0);
      expect(mockProvider.review).not.toHaveBeenCalled();
    });
  });

  // ── human mode ─────────────────────────────────────────────────────────────

  describe('human mode', () => {
    it('returns escalatedToHuman=true immediately without calling provider', async () => {
      const config: ReviewGateConfig = {
        ...baseConfig,
        phases: { ...baseConfig.phases, design: 'human' },
      };

      const result = await runReviewGate('design', '/path/design.md', '/cwd', config);

      expect(result.escalatedToHuman).toBe(true);
      expect(result.passed).toBe(false);
      expect(result.attempts).toBe(0);
      expect(mockProvider.review).not.toHaveBeenCalled();
    });
  });

  // ── auto mode ─────────────────────────────────────────────────────────────

  describe('auto mode', () => {
    it('passes on first attempt when review passes', async () => {
      mockProvider.review.mockResolvedValue(passingReview);

      const result = await runReviewGate('spec', '/path/spec.md', '/cwd', baseConfig);

      expect(result.passed).toBe(true);
      expect(result.attempts).toBe(1);
      expect(result.escalatedToHuman).toBe(false);
      expect(result.reviews).toHaveLength(1);
      expect(mockProvider.review).toHaveBeenCalledTimes(1);
    });

    it('retries on failure up to max_retries', async () => {
      mockProvider.review
        .mockResolvedValueOnce(failingReview)
        .mockResolvedValueOnce(failingReview)
        .mockResolvedValue(passingReview);

      const config: ReviewGateConfig = { ...baseConfig, max_retries: 2 };
      const result = await runReviewGate('tasks', '/path/tasks.md', '/cwd', config);

      expect(result.passed).toBe(true);
      // max_retries=2 → up to 3 attempts (1 initial + 2 retries)
      expect(result.attempts).toBe(3);
      expect(mockProvider.review).toHaveBeenCalledTimes(3);
    });

    it('escalates to human after all retries are exhausted', async () => {
      mockProvider.review.mockResolvedValue(failingReview);

      const config: ReviewGateConfig = { ...baseConfig, max_retries: 2 };
      const result = await runReviewGate('apply', '/path/apply.md', '/cwd', config);

      expect(result.passed).toBe(false);
      expect(result.escalatedToHuman).toBe(true);
      // 3 total attempts (1 + 2 retries)
      expect(result.attempts).toBe(3);
      expect(result.reviews).toHaveLength(3);
    });

    it('stops retrying as soon as a passing review is returned', async () => {
      mockProvider.review
        .mockResolvedValueOnce(failingReview)
        .mockResolvedValue(passingReview);

      const result = await runReviewGate('spec', '/path/spec.md', '/cwd', baseConfig);

      expect(result.passed).toBe(true);
      expect(result.attempts).toBe(2);
      expect(mockProvider.review).toHaveBeenCalledTimes(2);
    });

    it('uses the correct criteria string for each known phase', async () => {
      mockProvider.review.mockResolvedValue(passingReview);

      const phases = ['proposal', 'spec', 'design', 'tasks', 'apply'] as const;
      const config: ReviewGateConfig = {
        ...baseConfig,
        phases: Object.fromEntries(phases.map(p => [p, 'auto'])) as ReviewGateConfig['phases'],
      };

      for (const phase of phases) {
        vi.clearAllMocks();
        vi.mocked(getProviderAdapter).mockReturnValue(mockProvider as any);
        mockProvider.review.mockResolvedValue(passingReview);

        await runReviewGate(phase, '/path/artifact.md', '/cwd', config);

        const callArgs = mockProvider.review.mock.calls[0][0];
        // Each phase has unique criteria; spot-check that it is a non-empty string
        expect(typeof callArgs.criteria).toBe('string');
        expect(callArgs.criteria.length).toBeGreaterThan(0);
        // Ensure the criteria is phase-aware (it's different per phase)
        expect(callArgs.criteria).not.toBe(`Review this ${phase} artifact critically. Is it production-ready?`);
      }
    });

    it('passes artifactPath, model, and workingDir to the provider', async () => {
      mockProvider.review.mockResolvedValue(passingReview);

      await runReviewGate('spec', '/my/spec.md', '/my/cwd', baseConfig);

      expect(mockProvider.review).toHaveBeenCalledWith(
        expect.objectContaining({
          artifactPath: '/my/spec.md',
          model: 'opus',
          workingDir: '/my/cwd',
        }),
      );
    });
  });

  // ── unknown phase fallback ─────────────────────────────────────────────────

  describe('unknown phase', () => {
    it('uses a generic fallback criteria for phases not in PHASE_CRITERIA', async () => {
      mockProvider.review.mockResolvedValue(passingReview);

      const config: ReviewGateConfig = {
        ...baseConfig,
        phases: { unknown_phase: 'auto' },
      };

      const result = await runReviewGate('unknown_phase', '/path/x.md', '/cwd', config);
      expect(result.passed).toBe(true);

      const callArgs = mockProvider.review.mock.calls[0][0];
      expect(callArgs.criteria).toContain('unknown_phase');
    });
  });
});
