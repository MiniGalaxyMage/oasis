import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('./vault.js', () => ({
  listProjects: vi.fn(),
  hasInProgressTask: vi.fn(),
  getNextReadyTask: vi.fn(),
}));

vi.mock('./config.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../utils/platform.js', () => ({
  getPlatform: vi.fn(),
  getOasisConfigDir: vi.fn(() => '/tmp/.oasis'),
}));

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

vi.mock('node:fs', () => ({
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
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

import { pollProjects, installScheduler, removeScheduler, isSchedulerActive } from './scheduler.js';
import { listProjects, hasInProgressTask, getNextReadyTask } from './vault.js';
import { loadConfig } from './config.js';
import { getPlatform } from '../utils/platform.js';
import { execa } from 'execa';
import { writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import type { TaskFrontmatter } from './vault.js';

const mockListProjects = vi.mocked(listProjects);
const mockHasInProgressTask = vi.mocked(hasInProgressTask);
const mockGetNextReadyTask = vi.mocked(getNextReadyTask);
const mockLoadConfig = vi.mocked(loadConfig);
const mockGetPlatform = vi.mocked(getPlatform);
const mockExeca = vi.mocked(execa);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockExistsSync = vi.mocked(existsSync);
const mockUnlinkSync = vi.mocked(unlinkSync);
const mockMkdirSync = vi.mocked(mkdirSync);

function makeTask(overrides: Partial<TaskFrontmatter> = {}): TaskFrontmatter {
  return {
    id: 'task-001',
    title: 'Implement feature',
    status: 'ready',
    project: 'my-project',
    priority: 'medium',
    created: '2026-01-01',
    tags: [],
    complexity: 'medium',
    branch: 'feature/task-001',
    ...overrides,
  };
}

function makeConfig() {
  return { vault: '/vault', providers: { default: 'claude' } } as any;
}

describe('pollProjects()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockReturnValue(makeConfig());
    mockListProjects.mockReturnValue([]);
    mockHasInProgressTask.mockReturnValue(false);
    mockGetNextReadyTask.mockReturnValue(null);
  });

  it('returns empty result when no projects exist', () => {
    mockListProjects.mockReturnValue([]);

    const result = pollProjects();

    expect(result.readyTasks).toHaveLength(0);
    expect(result.busyProjects).toHaveLength(0);
    expect(result.idleProjects).toHaveLength(0);
  });

  it('skips projects with in-progress tasks and adds them to busyProjects', () => {
    mockListProjects.mockReturnValue(['project-a', 'project-b']);
    mockHasInProgressTask.mockImplementation((_vault, project) => project === 'project-a');
    mockGetNextReadyTask.mockReturnValue(null);

    const result = pollProjects();

    expect(result.busyProjects).toContain('project-a');
    expect(result.busyProjects).not.toContain('project-b');
    expect(mockGetNextReadyTask).not.toHaveBeenCalledWith(expect.anything(), 'project-a');
  });

  it('adds projects with a ready task to readyTasks', () => {
    const task = makeTask({ project: 'project-b' });
    mockListProjects.mockReturnValue(['project-b']);
    mockHasInProgressTask.mockReturnValue(false);
    mockGetNextReadyTask.mockReturnValue(task);

    const result = pollProjects();

    expect(result.readyTasks).toHaveLength(1);
    expect(result.readyTasks[0]).toEqual({ project: 'project-b', task });
    expect(result.idleProjects).toHaveLength(0);
  });

  it('adds idle projects when no ready task is found', () => {
    mockListProjects.mockReturnValue(['project-c']);
    mockHasInProgressTask.mockReturnValue(false);
    mockGetNextReadyTask.mockReturnValue(null);

    const result = pollProjects();

    expect(result.idleProjects).toContain('project-c');
    expect(result.readyTasks).toHaveLength(0);
  });

  it('returns correct structure with mixed busy/ready/idle projects', () => {
    const readyTask = makeTask({ project: 'project-b' });
    mockListProjects.mockReturnValue(['project-a', 'project-b', 'project-c']);
    mockHasInProgressTask.mockImplementation((_vault, project) => project === 'project-a');
    mockGetNextReadyTask.mockImplementation((_vault, project) =>
      project === 'project-b' ? readyTask : null,
    );

    const result = pollProjects();

    expect(result.busyProjects).toEqual(['project-a']);
    expect(result.readyTasks).toEqual([{ project: 'project-b', task: readyTask }]);
    expect(result.idleProjects).toEqual(['project-c']);
  });
});

describe('installScheduler()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);
    mockExistsSync.mockReturnValue(true);
  });

  it('on darwin: writes plist file and calls launchctl load', async () => {
    mockGetPlatform.mockReturnValue('darwin');

    await installScheduler(5);

    expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining('logs'), expect.objectContaining({ recursive: true }));
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('com.oasis.scheduler.plist'),
      expect.stringContaining('com.oasis.scheduler'),
      'utf-8',
    );
    expect(mockExeca).toHaveBeenCalledWith('launchctl', ['load', expect.stringContaining('com.oasis.scheduler.plist')]);
  });

  it('on darwin: plist contains the correct interval in seconds', async () => {
    mockGetPlatform.mockReturnValue('darwin');

    await installScheduler(10);

    const plistContent = mockWriteFileSync.mock.calls[0][1] as string;
    expect(plistContent).toContain('<integer>600</integer>'); // 10 * 60
  });

  it('on win32: calls schtasks /create with correct args', async () => {
    mockGetPlatform.mockReturnValue('win32');

    await installScheduler(15);

    expect(mockExeca).toHaveBeenCalledWith(
      'schtasks',
      expect.arrayContaining(['/create', '/tn', 'OasisScheduler', '/sc', 'MINUTE', '/mo', '15']),
    );
  });

  it('on linux: modifies crontab with correct interval', async () => {
    mockGetPlatform.mockReturnValue('linux');
    mockExeca
      .mockResolvedValueOnce({ stdout: '# existing crontab\n', stderr: '', exitCode: 0 } as any) // crontab -l
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any); // crontab -

    await installScheduler(30);

    // crontab -l to read existing
    expect(mockExeca).toHaveBeenCalledWith('crontab', ['-l']);
    // crontab - to write new
    expect(mockExeca).toHaveBeenCalledWith(
      'crontab',
      ['-'],
      expect.objectContaining({ input: expect.stringContaining('*/30 * * * * oasis scheduler run') }),
    );
  });

  it('on linux: handles empty crontab gracefully', async () => {
    mockGetPlatform.mockReturnValue('linux');
    mockExeca
      .mockRejectedValueOnce(new Error('no crontab')) // crontab -l fails
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any); // crontab -

    await installScheduler(5);

    expect(mockExeca).toHaveBeenCalledWith(
      'crontab',
      ['-'],
      expect.objectContaining({ input: expect.stringContaining('*/5 * * * * oasis scheduler run') }),
    );
  });
});

describe('removeScheduler()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);
    mockExistsSync.mockReturnValue(true);
  });

  it('on darwin: calls launchctl unload and removes plist file', async () => {
    mockGetPlatform.mockReturnValue('darwin');

    await removeScheduler();

    expect(mockExeca).toHaveBeenCalledWith('launchctl', ['unload', expect.stringContaining('com.oasis.scheduler.plist')]);
    expect(mockUnlinkSync).toHaveBeenCalledWith(expect.stringContaining('com.oasis.scheduler.plist'));
  });

  it('on darwin: skips launchctl unload if plist does not exist', async () => {
    mockGetPlatform.mockReturnValue('darwin');
    mockExistsSync.mockReturnValue(false);

    await removeScheduler();

    expect(mockExeca).not.toHaveBeenCalled();
    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });

  it('on win32: calls schtasks /delete', async () => {
    mockGetPlatform.mockReturnValue('win32');

    await removeScheduler();

    expect(mockExeca).toHaveBeenCalledWith('schtasks', ['/delete', '/tn', 'OasisScheduler', '/f']);
  });

  it('on linux: removes oasis line from crontab', async () => {
    mockGetPlatform.mockReturnValue('linux');
    mockExeca
      .mockResolvedValueOnce({
        stdout: '# keep this\n*/5 * * * * oasis scheduler run\n# also keep',
        stderr: '',
        exitCode: 0,
      } as any) // crontab -l
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any); // crontab -

    await removeScheduler();

    const writtenCrontab = (mockExeca.mock.calls[1] as any)[2]?.input as string;
    expect(writtenCrontab).not.toContain('oasis scheduler');
    expect(writtenCrontab).toContain('# keep this');
  });
});

describe('isSchedulerActive()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when launchd scheduler is running (darwin)', async () => {
    mockGetPlatform.mockReturnValue('darwin');
    mockExeca.mockResolvedValueOnce({ stdout: '{ "PID" = 1234; }', stderr: '', exitCode: 0 } as any);

    const result = await isSchedulerActive();

    expect(result).toBe(true);
    expect(mockExeca).toHaveBeenCalledWith('launchctl', ['list', 'com.oasis.scheduler']);
  });

  it('returns false when launchd scheduler is not running (darwin)', async () => {
    mockGetPlatform.mockReturnValue('darwin');
    mockExeca.mockRejectedValueOnce(new Error('No such process'));

    const result = await isSchedulerActive();

    expect(result).toBe(false);
  });

  it('returns true when schtasks shows OasisScheduler (win32)', async () => {
    mockGetPlatform.mockReturnValue('win32');
    mockExeca.mockResolvedValueOnce({ stdout: 'OasisScheduler  Ready', stderr: '', exitCode: 0 } as any);

    const result = await isSchedulerActive();

    expect(result).toBe(true);
    expect(mockExeca).toHaveBeenCalledWith('schtasks', ['/query', '/tn', 'OasisScheduler']);
  });

  it('returns false when schtasks does not find OasisScheduler (win32)', async () => {
    mockGetPlatform.mockReturnValue('win32');
    mockExeca.mockRejectedValueOnce(new Error('task not found'));

    const result = await isSchedulerActive();

    expect(result).toBe(false);
  });

  it('returns true when crontab contains oasis scheduler line (linux)', async () => {
    mockGetPlatform.mockReturnValue('linux');
    mockExeca.mockResolvedValueOnce({ stdout: '*/5 * * * * oasis scheduler run\n', stderr: '', exitCode: 0 } as any);

    const result = await isSchedulerActive();

    expect(result).toBe(true);
    expect(mockExeca).toHaveBeenCalledWith('crontab', ['-l']);
  });

  it('returns false when crontab does not contain oasis line (linux)', async () => {
    mockGetPlatform.mockReturnValue('linux');
    mockExeca.mockResolvedValueOnce({ stdout: '# no oasis here\n', stderr: '', exitCode: 0 } as any);

    const result = await isSchedulerActive();

    expect(result).toBe(false);
  });

  it('returns false when crontab command fails (linux)', async () => {
    mockGetPlatform.mockReturnValue('linux');
    mockExeca.mockRejectedValueOnce(new Error('no crontab for user'));

    const result = await isSchedulerActive();

    expect(result).toBe(false);
  });
});
