import { vi, describe, it, expect, beforeEach } from 'vitest';
import { gatherContext } from './context-gatherer.js';
import type { TaskFrontmatter } from './vault.js';
import type { OasisConfig } from './config.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('./vault.js', () => ({
  listProjects: vi.fn(),
  listTasks: vi.fn(),
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

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { listProjects, listTasks } from './vault.js';

const mockExistsSync = vi.mocked(existsSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockListProjects = vi.mocked(listProjects);
const mockListTasks = vi.mocked(listTasks);

function makeTask(overrides: Partial<TaskFrontmatter> = {}): TaskFrontmatter {
  return {
    id: 'task-001',
    title: 'Implement feature',
    status: 'ready',
    project: 'my-project',
    priority: 'medium',
    created: '2026-01-01',
    tags: ['auth', 'api'],
    complexity: 'medium',
    branch: 'feature/task-001',
    ...overrides,
  };
}

function makeConfig(vaultPath = '/vault'): OasisConfig {
  return {
    vault: vaultPath,
    providers: { default: 'claude' },
  } as OasisConfig;
}

describe('gatherContext()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: wiki dir does not exist, skills dir does not exist
    mockExistsSync.mockReturnValue(false);
    mockListProjects.mockReturnValue([]);
    mockListTasks.mockReturnValue([]);
  });

  describe('cross-project tasks', () => {
    it('finds cross-project tasks by shared tags', async () => {
      const task = makeTask({ id: 'task-001', tags: ['auth', 'api'], project: 'project-a' });

      mockListProjects.mockReturnValue(['project-a', 'project-b']);
      mockListTasks
        .mockReturnValueOnce([
          // project-a tasks — task-001 itself should be skipped
          { ...task, id: 'task-001' },
          { id: 'task-002', title: 'Auth refactor', status: 'done', project: 'project-a', priority: 'high', created: '2026-01-01', tags: ['auth'], complexity: 'low', branch: '' },
        ])
        .mockReturnValueOnce([
          // project-b tasks
          { id: 'task-003', title: 'API gateway', status: 'in-progress', project: 'project-b', priority: 'medium', created: '2026-01-01', tags: ['api', 'gateway'], complexity: 'medium', branch: '' },
        ]);

      const result = await gatherContext(task, makeConfig());

      expect(result.crossProject).toHaveLength(2);
      expect(result.crossProject[0]).toContain('project-a/task-002');
      expect(result.crossProject[0]).toContain('Auth refactor');
      expect(result.crossProject[1]).toContain('project-b/task-003');
      expect(result.crossProject[1]).toContain('API gateway');
    });

    it('returns empty crossProject when task has no tags', async () => {
      const task = makeTask({ tags: [] });

      const result = await gatherContext(task, makeConfig());

      expect(result.crossProject).toEqual([]);
      // listProjects should not even be called when there are no tags
      expect(mockListProjects).not.toHaveBeenCalled();
    });

    it('skips the current task itself when scanning the same project', async () => {
      const task = makeTask({ id: 'task-001', tags: ['auth'], project: 'project-a' });

      mockListProjects.mockReturnValue(['project-a']);
      mockListTasks.mockReturnValue([
        { ...task, id: 'task-001' }, // same task — should be skipped
      ]);

      const result = await gatherContext(task, makeConfig());

      expect(result.crossProject).toHaveLength(0);
    });

    it('does not include tasks with no shared tags', async () => {
      const task = makeTask({ tags: ['auth'], project: 'project-a' });

      mockListProjects.mockReturnValue(['project-b']);
      mockListTasks.mockReturnValue([
        { id: 'task-x', title: 'Unrelated', status: 'ready', project: 'project-b', priority: 'low', created: '2026-01-01', tags: ['database'], complexity: 'low', branch: '' },
      ]);

      const result = await gatherContext(task, makeConfig());

      expect(result.crossProject).toHaveLength(0);
    });
  });

  describe('wiki pages', () => {
    it('finds wiki pages by tag name matching filename', async () => {
      const task = makeTask({ tags: ['auth'], title: 'Implement auth flow' });

      // wiki dir exists
      mockExistsSync.mockImplementation((p: unknown) => {
        const path = p as string;
        return path.endsWith('wiki') || path.endsWith('concepts');
      });
      mockReaddirSync.mockImplementation((p: unknown) => {
        const path = p as string;
        if (path.endsWith('concepts')) return ['auth-guide.md', 'unrelated.md'] as any;
        return [] as any;
      });
      mockReadFileSync.mockReturnValue('# Auth Guide\nThis is the auth guide content.\nMore content here.\n' as any);

      const result = await gatherContext(task, makeConfig());

      expect(result.wiki).toHaveLength(1);
      expect(result.wiki[0]).toContain('wiki/concepts/auth-guide.md');
      expect(result.wiki[0]).toContain('Auth Guide');
    });

    it('handles missing wiki directory gracefully', async () => {
      const task = makeTask({ tags: ['auth'] });

      mockExistsSync.mockReturnValue(false);

      const result = await gatherContext(task, makeConfig());

      expect(result.wiki).toEqual([]);
    });

    it('matches wiki pages by title words longer than 3 chars', async () => {
      const task = makeTask({ tags: [], title: 'Setup postgres database' });

      mockExistsSync.mockImplementation((p: unknown) => {
        const path = p as string;
        return path.endsWith('wiki') || path.endsWith('patterns');
      });
      mockReaddirSync.mockImplementation((p: unknown) => {
        const path = p as string;
        if (path.endsWith('patterns')) return ['postgres-setup.md'] as any;
        return [] as any;
      });
      mockReadFileSync.mockReturnValue('# Postgres Setup\nConfiguration guide.' as any);

      const result = await gatherContext(task, makeConfig());

      expect(result.wiki).toHaveLength(1);
      expect(result.wiki[0]).toContain('wiki/patterns/postgres-setup.md');
    });

    it('does not match wiki pages for words 3 chars or fewer', async () => {
      const task = makeTask({ tags: [], title: 'Fix bug in API' });

      mockExistsSync.mockImplementation((p: unknown) => {
        const path = p as string;
        return path.endsWith('wiki') || path.endsWith('concepts');
      });
      mockReaddirSync.mockImplementation((p: unknown) => {
        const path = p as string;
        if (path.endsWith('concepts')) return ['api.md', 'fix.md', 'bug.md'] as any;
        return [] as any;
      });
      mockReadFileSync.mockReturnValue('content' as any);

      const result = await gatherContext(task, makeConfig());

      // "Fix" (3), "bug" (3), "in" (2), "API" (3) — none exceed 3 chars, tags is empty too
      expect(result.wiki).toHaveLength(0);
    });
  });

  describe('project skills', () => {
    it('finds relevant project skills by tag', async () => {
      const task = makeTask({ tags: ['auth'], project: 'my-project' });

      mockExistsSync.mockImplementation((p: unknown) => {
        const path = p as string;
        return path.includes('skills');
      });
      mockReaddirSync.mockImplementation((p: unknown) => {
        const path = p as string;
        if (path.includes('skills')) return ['auth-pattern.md', 'deploy.md'] as any;
        return [] as any;
      });

      const result = await gatherContext(task, makeConfig());

      expect(result.sources).toHaveLength(1);
      expect(result.sources[0]).toBe('skill: my-project/skills/auth-pattern.md');
    });

    it('does not include skills whose name does not match any tag', async () => {
      const task = makeTask({ tags: ['auth'], project: 'my-project' });

      mockExistsSync.mockImplementation((p: unknown) => {
        const path = p as string;
        return path.includes('skills');
      });
      mockReaddirSync.mockReturnValue(['deploy.md', 'testing.md'] as any);

      const result = await gatherContext(task, makeConfig());

      expect(result.sources).toHaveLength(0);
    });
  });

  describe('summary formatting', () => {
    it('builds formatted markdown summary with all sections when all data is present', async () => {
      const task = makeTask({ tags: ['auth'], project: 'project-a' });

      // Cross-project
      mockListProjects.mockReturnValue(['project-b']);
      mockListTasks.mockReturnValue([
        { id: 'task-x', title: 'Related auth task', status: 'done', project: 'project-b', priority: 'low', created: '2026-01-01', tags: ['auth'], complexity: 'low', branch: '' },
      ]);

      // Wiki
      mockExistsSync.mockImplementation((p: unknown) => {
        const path = p as string;
        return path.endsWith('wiki') || path.endsWith('concepts') || path.includes('skills');
      });
      mockReaddirSync.mockImplementation((p: unknown) => {
        const path = p as string;
        if (path.endsWith('concepts')) return ['auth-guide.md'] as any;
        if (path.includes('skills')) return ['auth-pattern.md'] as any;
        return [] as any;
      });
      mockReadFileSync.mockReturnValue('# Auth Guide\nContent here.' as any);

      const result = await gatherContext(task, makeConfig());

      expect(result.summary).toContain('### Related tasks across projects');
      expect(result.summary).toContain('### Relevant wiki pages');
      expect(result.summary).toContain('### Relevant skills');
    });

    it("returns 'No additional context found.' when nothing matches", async () => {
      const task = makeTask({ tags: [] });

      mockExistsSync.mockReturnValue(false);

      const result = await gatherContext(task, makeConfig());

      expect(result.summary).toBe('No additional context found.');
    });

    it('returns only cross-project section when only related tasks are found', async () => {
      const task = makeTask({ tags: ['api'], project: 'project-a' });

      mockListProjects.mockReturnValue(['project-b']);
      mockListTasks.mockReturnValue([
        { id: 'task-y', title: 'API refactor', status: 'ready', project: 'project-b', priority: 'medium', created: '2026-01-01', tags: ['api'], complexity: 'low', branch: '' },
      ]);
      mockExistsSync.mockReturnValue(false);

      const result = await gatherContext(task, makeConfig());

      expect(result.summary).toContain('### Related tasks across projects');
      expect(result.summary).not.toContain('### Relevant wiki pages');
      expect(result.summary).not.toContain('### Relevant skills');
    });
  });
});
