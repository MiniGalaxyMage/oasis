import { vi } from 'vitest';
import { execa } from 'execa';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import {
  isGitInstalled,
  getGitVersion,
  isGitRepo,
  getCurrentBranch,
  createBranch,
} from './git.js';

const mockExeca = vi.mocked(execa);

beforeEach(() => {
  vi.clearAllMocks();
});

// ── isGitInstalled ────────────────────────────────────────────────────────────

describe('isGitInstalled', () => {
  it('returns true when git --version succeeds', async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: 'git version 2.44.0',
      stderr: '',
      exitCode: 0,
    } as any);

    expect(await isGitInstalled()).toBe(true);
    expect(mockExeca).toHaveBeenCalledWith('git', ['--version']);
  });

  it('returns false when git is not found (execa throws)', async () => {
    mockExeca.mockRejectedValueOnce(new Error('ENOENT: git not found'));

    expect(await isGitInstalled()).toBe(false);
  });
});

// ── getGitVersion ─────────────────────────────────────────────────────────────

describe('getGitVersion', () => {
  it('extracts the semver version from "git version 2.44.0"', async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: 'git version 2.44.0',
      stderr: '',
      exitCode: 0,
    } as any);

    const version = await getGitVersion();
    expect(version).toBe('2.44.0');
  });

  it('returns "unknown" when stdout does not contain a version number', async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: 'git (no version)',
      stderr: '',
      exitCode: 0,
    } as any);

    const version = await getGitVersion();
    expect(version).toBe('unknown');
  });
});

// ── isGitRepo ─────────────────────────────────────────────────────────────────

describe('isGitRepo', () => {
  it('returns true when inside a git repository', async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: '.git',
      stderr: '',
      exitCode: 0,
    } as any);

    expect(await isGitRepo('/some/repo')).toBe(true);
    expect(mockExeca).toHaveBeenCalledWith('git', ['rev-parse', '--git-dir'], { cwd: '/some/repo' });
  });

  it('returns false when not inside a git repository (execa throws)', async () => {
    mockExeca.mockRejectedValueOnce(new Error('not a git repository'));

    expect(await isGitRepo('/some/dir')).toBe(false);
  });
});

// ── getCurrentBranch ──────────────────────────────────────────────────────────

describe('getCurrentBranch', () => {
  it('returns the trimmed branch name', async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: '  main  \n',
      stderr: '',
      exitCode: 0,
    } as any);

    const branch = await getCurrentBranch('/some/repo');
    expect(branch).toBe('main');
    expect(mockExeca).toHaveBeenCalledWith('git', ['branch', '--show-current'], { cwd: '/some/repo' });
  });

  it('handles branch names without extra whitespace', async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: 'feature/my-branch',
      stderr: '',
      exitCode: 0,
    } as any);

    expect(await getCurrentBranch('/some/repo')).toBe('feature/my-branch');
  });
});

// ── createBranch ──────────────────────────────────────────────────────────────

describe('createBranch', () => {
  it('calls git checkout -b with the correct dir and branch name', async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 0,
    } as any);

    await createBranch('/some/repo', 'feature/new-branch');

    expect(mockExeca).toHaveBeenCalledWith(
      'git',
      ['checkout', '-b', 'feature/new-branch'],
      { cwd: '/some/repo' },
    );
  });

  it('propagates errors thrown by execa', async () => {
    mockExeca.mockRejectedValueOnce(new Error('branch already exists'));

    await expect(createBranch('/some/repo', 'existing-branch')).rejects.toThrow('branch already exists');
  });
});
