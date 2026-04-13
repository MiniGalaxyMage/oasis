import { vi, describe, it, expect, beforeEach } from 'vitest';
import { generateSkill } from './skill-generator.js';
import type { TaskFrontmatter } from './vault.js';
import type { OasisConfig } from './config.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
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

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { getProviderAdapter } from '../providers/index.js';

const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockGetProviderAdapter = vi.mocked(getProviderAdapter);

function makeTask(overrides: Partial<TaskFrontmatter> = {}): TaskFrontmatter {
  return {
    id: 'task-001',
    title: 'Build auth middleware',
    status: 'done',
    project: 'my-project',
    priority: 'high',
    created: '2026-01-01',
    tags: ['auth', 'middleware'],
    complexity: 'high',
    branch: 'feature/task-001',
    provider: 'claude',
    ...overrides,
  };
}

function makeConfig(vaultPath = '/vault'): OasisConfig {
  return {
    vault: vaultPath,
    providers: { default: 'claude' },
  } as OasisConfig;
}

function makeProviderAdapter(overrides: Record<string, any> = {}) {
  return {
    name: 'claude',
    isAvailable: vi.fn().mockResolvedValue(true),
    getVersion: vi.fn().mockResolvedValue('1.0.0'),
    execute: vi.fn().mockResolvedValue({ stdout: '# Skill Content\n---\nname: "test"\n---\n', stderr: '', exitCode: 0 }),
    review: vi.fn(),
    ...overrides,
  };
}

describe('generateSkill()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: directories exist
    mockExistsSync.mockReturnValue(true);
  });

  it('returns null for non-high complexity tasks (skips generation)', async () => {
    const task = makeTask({ complexity: 'medium' });

    const result = await generateSkill(task, 'task content', makeConfig());

    expect(result).toBeNull();
    expect(mockGetProviderAdapter).not.toHaveBeenCalled();
  });

  it('returns null for low complexity tasks', async () => {
    const task = makeTask({ complexity: 'low' });

    const result = await generateSkill(task, 'task content', makeConfig());

    expect(result).toBeNull();
  });

  it('returns null when provider is unavailable', async () => {
    const task = makeTask({ complexity: 'high' });
    const adapter = makeProviderAdapter({ isAvailable: vi.fn().mockResolvedValue(false) });
    mockGetProviderAdapter.mockReturnValue(adapter as any);

    const result = await generateSkill(task, 'task content', makeConfig());

    expect(result).toBeNull();
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it('generates skill file for high complexity task and calls writeFileSync for skills dir', async () => {
    const task = makeTask({ complexity: 'high', title: 'Build auth middleware' });
    const adapter = makeProviderAdapter();
    mockGetProviderAdapter.mockReturnValue(adapter as any);
    mockExistsSync.mockReturnValue(true);

    const result = await generateSkill(task, 'task content here', makeConfig());

    expect(result).not.toBeNull();
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('build-auth-middleware.md'),
      expect.any(String),
      'utf-8',
    );
  });

  it('creates skills directory if it does not exist', async () => {
    const task = makeTask({ complexity: 'high', project: 'my-project' });
    const adapter = makeProviderAdapter();
    mockGetProviderAdapter.mockReturnValue(adapter as any);
    // skills dir missing, wiki/patterns dir exists
    mockExistsSync.mockImplementation((p: unknown) => {
      const path = p as string;
      return !path.includes('skills') || path.includes('wiki');
    });

    await generateSkill(task, 'content', makeConfig());

    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('skills'),
      expect.objectContaining({ recursive: true }),
    );
  });

  it('creates wiki pattern reference file', async () => {
    const task = makeTask({ complexity: 'high', id: 'task-001', project: 'my-project', title: 'Build auth middleware' });
    const adapter = makeProviderAdapter();
    mockGetProviderAdapter.mockReturnValue(adapter as any);
    // wiki/patterns dir does not exist to trigger mkdirSync for it; skills dir exists
    mockExistsSync.mockImplementation((p: unknown) => {
      const path = p as string;
      if (path.includes('wiki/patterns')) return false;
      return true;
    });

    await generateSkill(task, 'content', makeConfig());

    // mkdirSync called for wiki/patterns
    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('wiki/patterns'),
      expect.objectContaining({ recursive: true }),
    );
    // writeFileSync called for wiki entry (second call after skill write)
    const wikiCall = mockWriteFileSync.mock.calls.find(
      c => (c[0] as string).includes('wiki/patterns'),
    );
    expect(wikiCall).toBeDefined();
    expect(wikiCall![1] as string).toContain('my-project');
    expect(wikiCall![1] as string).toContain('task-001');
  });

  it('does not overwrite existing wiki pattern reference', async () => {
    const task = makeTask({ complexity: 'high' });
    const adapter = makeProviderAdapter();
    mockGetProviderAdapter.mockReturnValue(adapter as any);
    // both skills and wiki/patterns already exist
    mockExistsSync.mockReturnValue(true);

    await generateSkill(task, 'content', makeConfig());

    // writeFileSync should only be called once (for the skill file), not for the wiki entry
    const wikiCall = mockWriteFileSync.mock.calls.find(
      c => (c[0] as string).includes('wiki/patterns'),
    );
    expect(wikiCall).toBeUndefined();
  });

  it('handles provider execution failure gracefully', async () => {
    const task = makeTask({ complexity: 'high' });
    const adapter = makeProviderAdapter({
      execute: vi.fn().mockResolvedValue({ stdout: '', stderr: 'error', exitCode: 1 }),
    });
    mockGetProviderAdapter.mockReturnValue(adapter as any);

    const result = await generateSkill(task, 'content', makeConfig());

    expect(result).toBeNull();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('handles provider execution returning empty output', async () => {
    const task = makeTask({ complexity: 'high' });
    const adapter = makeProviderAdapter({
      execute: vi.fn().mockResolvedValue({ stdout: '   ', stderr: '', exitCode: 0 }),
    });
    mockGetProviderAdapter.mockReturnValue(adapter as any);

    const result = await generateSkill(task, 'content', makeConfig());

    expect(result).toBeNull();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('uses task.provider if set, falls back to config default', async () => {
    const taskWithProvider = makeTask({ complexity: 'high', provider: 'codex' });
    const adapter = makeProviderAdapter();
    mockGetProviderAdapter.mockReturnValue(adapter as any);

    await generateSkill(taskWithProvider, 'content', makeConfig());

    expect(mockGetProviderAdapter).toHaveBeenCalledWith('codex');
  });

  it('uses config.providers.default when task.provider is not set', async () => {
    const task = makeTask({ complexity: 'high', provider: undefined });
    const adapter = makeProviderAdapter();
    mockGetProviderAdapter.mockReturnValue(adapter as any);

    await generateSkill(task, 'content', makeConfig());

    expect(mockGetProviderAdapter).toHaveBeenCalledWith('claude');
  });

  it('returns the skill file path on success', async () => {
    const task = makeTask({ complexity: 'high', project: 'my-project', title: 'Build auth middleware' });
    const adapter = makeProviderAdapter();
    mockGetProviderAdapter.mockReturnValue(adapter as any);
    mockExistsSync.mockReturnValue(true);

    const result = await generateSkill(task, 'content', makeConfig('/vault'));

    expect(result).toBe('/vault/projects/my-project/skills/build-auth-middleware.md');
  });

  it('builds prompt including task id, title, project and tags', async () => {
    const task = makeTask({ complexity: 'high', id: 'task-042', title: 'Setup CI pipeline', project: 'devops', tags: ['ci', 'github-actions'] });
    const adapter = makeProviderAdapter();
    mockGetProviderAdapter.mockReturnValue(adapter as any);

    await generateSkill(task, 'task body content', makeConfig());

    const executeCall = adapter.execute.mock.calls[0][0];
    expect(executeCall.prompt).toContain('task-042');
    expect(executeCall.prompt).toContain('Setup CI pipeline');
    expect(executeCall.prompt).toContain('devops');
    expect(executeCall.prompt).toContain('ci');
    expect(executeCall.prompt).toContain('github-actions');
    expect(executeCall.prompt).toContain('task body content');
  });
});
