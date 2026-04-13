import { vi, describe, it, expect, beforeEach } from 'vitest';
import { join } from 'node:path';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import * as fs from 'node:fs';
import {
  createVaultStructure,
  registerProject,
  listProjects,
  listTasks,
  getNextReadyTask,
  hasInProgressTask,
} from './vault.js';

const VAULT = '/test/vault';

describe('createVaultStructure()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: nothing exists yet
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  it('creates all required directories', () => {
    createVaultStructure(VAULT);

    const expectedDirs = [
      '_oasis/templates',
      'projects',
      'wiki/concepts',
      'wiki/patterns',
      'wiki/entities',
      'wiki/summaries',
      'raw-sources',
    ];

    for (const dir of expectedDirs) {
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        join(VAULT, dir),
        { recursive: true },
      );
    }
  });

  it('writes schema.md, task template, index.md, log.md, Action-Tracker.md when they do not exist', () => {
    createVaultStructure(VAULT);

    const writtenPaths = vi.mocked(fs.writeFileSync).mock.calls.map(c => c[0] as string);

    expect(writtenPaths).toContain(join(VAULT, '_oasis/schema.md'));
    expect(writtenPaths).toContain(join(VAULT, '_oasis/templates/task.md'));
    expect(writtenPaths).toContain(join(VAULT, '_oasis/index.md'));
    expect(writtenPaths).toContain(join(VAULT, 'log.md'));
    expect(writtenPaths).toContain(join(VAULT, 'Action-Tracker.md'));
  });

  it('does NOT overwrite files that already exist (idempotent)', () => {
    // Everything already exists
    vi.mocked(fs.existsSync).mockReturnValue(true);

    createVaultStructure(VAULT);

    expect(fs.mkdirSync).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
});

describe('registerProject()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  it('creates backlog, decisions, and skills subdirectories', () => {
    registerProject(VAULT, 'my-app');

    const base = join(VAULT, 'projects', 'my-app');
    for (const dir of ['backlog', 'decisions', 'skills']) {
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        join(base, dir),
        { recursive: true },
      );
    }
  });

  it('writes default project.yaml', () => {
    registerProject(VAULT, 'my-app');

    const yamlPath = join(VAULT, 'projects', 'my-app', 'project.yaml');
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      yamlPath,
      expect.stringContaining('my-app'),
      'utf-8',
    );
  });

  it('does not overwrite project.yaml when it already exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    registerProject(VAULT, 'my-app');

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
});

describe('listProjects()', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns directory names from projects/', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: 'alpha', isDirectory: () => true },
      { name: 'beta', isDirectory: () => true },
      { name: 'notes.md', isDirectory: () => false },
    ] as any);

    const result = listProjects(VAULT);
    expect(result).toEqual(['alpha', 'beta']);
  });

  it('returns [] when projects dir does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = listProjects(VAULT);
    expect(result).toEqual([]);
    expect(fs.readdirSync).not.toHaveBeenCalled();
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────

function makeTaskMd(overrides: Record<string, unknown> = {}): string {
  const defaults = {
    id: 'TEST-001',
    title: 'Test task',
    status: 'ready',
    project: 'test',
    priority: 'high',
    created: '2026-01-01',
    tags: [],
    complexity: 'low',
    branch: '',
    ...overrides,
  };

  const lines = Object.entries(defaults).map(([k, v]) =>
    typeof v === 'string'
      ? `${k}: "${v}"`
      : `${k}: ${JSON.stringify(v)}`,
  );

  return `---\n${lines.join('\n')}\n---\n\nContent here\n`;
}

describe('listTasks()', () => {
  const PROJECT = 'my-project';

  beforeEach(() => vi.resetAllMocks());

  it('returns [] when backlog dir does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = listTasks(VAULT, PROJECT);
    expect(result).toEqual([]);
  });

  it('parses frontmatter correctly from task .md files', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['TEST-001.md'] as any);
    vi.mocked(fs.readFileSync).mockReturnValue(makeTaskMd({ id: 'TEST-001', title: 'Test task', status: 'ready' }));

    const result = listTasks(VAULT, PROJECT);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('TEST-001');
    expect(result[0].title).toBe('Test task');
    expect(result[0].status).toBe('ready');
    expect(result[0].priority).toBe('high');
  });

  it('filters by status when statusFilter is provided', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['T-001.md', 'T-002.md'] as any);
    vi.mocked(fs.readFileSync)
      .mockReturnValueOnce(makeTaskMd({ id: 'T-001', status: 'ready' }))
      .mockReturnValueOnce(makeTaskMd({ id: 'T-002', status: 'backlog' }));

    const result = listTasks(VAULT, PROJECT, 'ready');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('T-001');
  });

  it('skips malformed files without crashing', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['bad.md', 'good.md'] as any);
    // Simulate a readFileSync throw for the bad file, then a good file
    vi.mocked(fs.readFileSync)
      .mockImplementationOnce(() => { throw new Error('read error'); })
      .mockReturnValueOnce(makeTaskMd({ id: 'GOOD-001', status: 'ready' }));

    let result: ReturnType<typeof listTasks>;
    expect(() => { result = listTasks(VAULT, PROJECT); }).not.toThrow();
    expect(result!).toHaveLength(1);
    expect(result![0].id).toBe('GOOD-001');
  });
});

describe('getNextReadyTask()', () => {
  const PROJECT = 'my-project';

  beforeEach(() => vi.resetAllMocks());

  it('returns null when there are no ready tasks', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    expect(getNextReadyTask(VAULT, PROJECT)).toBeNull();
  });

  it('returns the highest priority task (critical > high > medium > low)', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['T-1.md', 'T-2.md', 'T-3.md'] as any);
    vi.mocked(fs.readFileSync)
      .mockReturnValueOnce(makeTaskMd({ id: 'T-1', status: 'ready', priority: 'low' }))
      .mockReturnValueOnce(makeTaskMd({ id: 'T-2', status: 'ready', priority: 'critical' }))
      .mockReturnValueOnce(makeTaskMd({ id: 'T-3', status: 'ready', priority: 'medium' }));

    const result = getNextReadyTask(VAULT, PROJECT);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('T-2');
    expect(result!.priority).toBe('critical');
  });
});

describe('hasInProgressTask()', () => {
  const PROJECT = 'my-project';

  beforeEach(() => vi.resetAllMocks());

  it('returns true when there is an in-progress task', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['T-1.md'] as any);
    vi.mocked(fs.readFileSync).mockReturnValue(
      makeTaskMd({ id: 'T-1', status: 'in-progress' }),
    );

    expect(hasInProgressTask(VAULT, PROJECT)).toBe(true);
  });

  it('returns false when there are no in-progress tasks', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['T-1.md'] as any);
    vi.mocked(fs.readFileSync).mockReturnValue(
      makeTaskMd({ id: 'T-1', status: 'ready' }),
    );

    expect(hasInProgressTask(VAULT, PROJECT)).toBe(false);
  });

  it('returns false when backlog dir does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    expect(hasInProgressTask(VAULT, PROJECT)).toBe(false);
  });
});
