import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createVaultStructure,
  registerProject,
  listProjects,
  listTasks,
  getNextReadyTask,
  hasInProgressTask,
} from '../../src/core/vault.js';

describe('Vault Integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'oasis-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates full vault structure on disk', () => {
    createVaultStructure(tempDir);

    expect(existsSync(join(tempDir, '_oasis', 'templates'))).toBe(true);
    expect(existsSync(join(tempDir, '_oasis', 'schema.md'))).toBe(true);
    expect(existsSync(join(tempDir, '_oasis', 'index.md'))).toBe(true);
    expect(existsSync(join(tempDir, '_oasis', 'templates', 'task.md'))).toBe(true);
    expect(existsSync(join(tempDir, 'projects'))).toBe(true);
    expect(existsSync(join(tempDir, 'wiki', 'concepts'))).toBe(true);
    expect(existsSync(join(tempDir, 'wiki', 'patterns'))).toBe(true);
    expect(existsSync(join(tempDir, 'wiki', 'entities'))).toBe(true);
    expect(existsSync(join(tempDir, 'wiki', 'summaries'))).toBe(true);
    expect(existsSync(join(tempDir, 'raw-sources'))).toBe(true);
    expect(existsSync(join(tempDir, 'log.md'))).toBe(true);
    expect(existsSync(join(tempDir, 'Action-Tracker.md'))).toBe(true);
  });

  it('createVaultStructure is idempotent', () => {
    createVaultStructure(tempDir);
    const schemaBefore = readFileSync(join(tempDir, '_oasis', 'schema.md'), 'utf-8');
    createVaultStructure(tempDir);
    const schemaAfter = readFileSync(join(tempDir, '_oasis', 'schema.md'), 'utf-8');
    expect(schemaBefore).toBe(schemaAfter);
  });

  it('registers a project with all subdirectories', () => {
    createVaultStructure(tempDir);
    registerProject(tempDir, 'my-project');

    expect(existsSync(join(tempDir, 'projects', 'my-project', 'backlog'))).toBe(true);
    expect(existsSync(join(tempDir, 'projects', 'my-project', 'decisions'))).toBe(true);
    expect(existsSync(join(tempDir, 'projects', 'my-project', 'skills'))).toBe(true);
    expect(existsSync(join(tempDir, 'projects', 'my-project', 'project.yaml'))).toBe(true);
  });

  it('listProjects returns registered projects', () => {
    createVaultStructure(tempDir);
    registerProject(tempDir, 'alpha');
    registerProject(tempDir, 'beta');

    const projects = listProjects(tempDir);
    expect(projects).toContain('alpha');
    expect(projects).toContain('beta');
  });

  it('full task lifecycle: create → list → query', () => {
    createVaultStructure(tempDir);
    registerProject(tempDir, 'test-proj');

    const taskContent = `---
id: "TP-001"
title: "Test task one"
status: ready
project: "test-proj"
priority: high
created: "2026-01-01"
tags:
  - testing
complexity: low
branch: ""
---

## Description
This is a test task.
`;
    writeFileSync(
      join(tempDir, 'projects', 'test-proj', 'backlog', 'TP-001.md'),
      taskContent,
      'utf-8',
    );

    const task2 = `---
id: "TP-002"
title: "Another task"
status: ready
project: "test-proj"
priority: critical
created: "2026-01-02"
tags:
  - testing
complexity: medium
branch: ""
---

## Description
Second test task.
`;
    writeFileSync(
      join(tempDir, 'projects', 'test-proj', 'backlog', 'TP-002.md'),
      task2,
      'utf-8',
    );

    const allTasks = listTasks(tempDir, 'test-proj');
    expect(allTasks).toHaveLength(2);

    const readyTasks = listTasks(tempDir, 'test-proj', 'ready');
    expect(readyTasks).toHaveLength(2);

    const doneTasks = listTasks(tempDir, 'test-proj', 'done');
    expect(doneTasks).toHaveLength(0);

    const next = getNextReadyTask(tempDir, 'test-proj');
    expect(next).not.toBeNull();
    expect(next!.id).toBe('TP-002'); // critical > high
    expect(next!.priority).toBe('critical');
  });

  it('hasInProgressTask detects active work', () => {
    createVaultStructure(tempDir);
    registerProject(tempDir, 'proj');

    expect(hasInProgressTask(tempDir, 'proj')).toBe(false);

    const taskContent = `---
id: "P-001"
title: "Active task"
status: in-progress
project: "proj"
priority: medium
created: "2026-01-01"
tags: []
complexity: low
branch: "feat/P-001"
---
`;
    writeFileSync(
      join(tempDir, 'projects', 'proj', 'backlog', 'P-001.md'),
      taskContent,
      'utf-8',
    );

    expect(hasInProgressTask(tempDir, 'proj')).toBe(true);
  });
});
