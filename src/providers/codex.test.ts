import { vi, describe, it, expect, beforeEach } from 'vitest';
import { CodexAdapter } from './codex.js';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import { execa } from 'execa';

const mockExeca = vi.mocked(execa);

describe('CodexAdapter', () => {
  let adapter: CodexAdapter;

  beforeEach(() => {
    adapter = new CodexAdapter();
    vi.clearAllMocks();
  });

  describe('isAvailable()', () => {
    it('returns true when codex --version succeeds', async () => {
      mockExeca.mockResolvedValueOnce({ stdout: '1.0.0', stderr: '', exitCode: 0 } as any);

      const result = await adapter.isAvailable();

      expect(result).toBe(true);
      expect(mockExeca).toHaveBeenCalledWith('codex', ['--version']);
    });

    it('returns false when command not found', async () => {
      mockExeca.mockRejectedValueOnce(new Error('command not found: codex'));

      const result = await adapter.isAvailable();

      expect(result).toBe(false);
    });
  });

  describe('getVersion()', () => {
    it('returns trimmed version string from stdout', async () => {
      mockExeca.mockResolvedValueOnce({ stdout: '  2.0.0  ', stderr: '', exitCode: 0 } as any);

      const result = await adapter.getVersion();

      expect(result).toBe('2.0.0');
    });

    it('returns "unknown" when command fails', async () => {
      mockExeca.mockRejectedValueOnce(new Error('command not found'));

      const result = await adapter.getVersion();

      expect(result).toBe('unknown');
    });
  });

  describe('execute()', () => {
    it('uses -q flag instead of -p for prompt', async () => {
      mockExeca.mockResolvedValueOnce({ stdout: 'output', stderr: '', exitCode: 0 } as any);

      await adapter.execute({ prompt: 'test prompt', workingDir: '/tmp' });

      expect(mockExeca).toHaveBeenCalledWith(
        'codex',
        ['-q', 'test prompt'],
        expect.objectContaining({ cwd: '/tmp' }),
      );
    });

    it('does NOT pass --allowedTools even when provided', async () => {
      mockExeca.mockResolvedValueOnce({ stdout: 'output', stderr: '', exitCode: 0 } as any);

      await adapter.execute({ prompt: 'test', workingDir: '/tmp', allowedTools: ['Read', 'Write'] });

      const callArgs = mockExeca.mock.calls[0];
      const args = callArgs[1] as string[];
      expect(args).not.toContain('--allowedTools');
      expect(args).not.toContain('Read,Write');
    });

    it('passes --model when provided', async () => {
      mockExeca.mockResolvedValueOnce({ stdout: 'output', stderr: '', exitCode: 0 } as any);

      await adapter.execute({ prompt: 'test', workingDir: '/tmp', model: 'o4-mini' });

      expect(mockExeca).toHaveBeenCalledWith(
        'codex',
        ['-q', 'test', '--model', 'o4-mini'],
        expect.objectContaining({ cwd: '/tmp' }),
      );
    });

    it('adds extra flags when provided', async () => {
      mockExeca.mockResolvedValueOnce({ stdout: 'output', stderr: '', exitCode: 0 } as any);

      await adapter.execute({ prompt: 'test', workingDir: '/tmp', flags: ['--no-color'] });

      expect(mockExeca).toHaveBeenCalledWith(
        'codex',
        ['-q', 'test', '--no-color'],
        expect.objectContaining({ cwd: '/tmp' }),
      );
    });

    it('returns exitCode 1 on error', async () => {
      const error: any = new Error('process failed');
      error.stdout = '';
      error.stderr = 'fatal error';
      error.exitCode = 1;
      mockExeca.mockRejectedValueOnce(error);

      const result = await adapter.execute({ prompt: 'test', workingDir: '/tmp' });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('fatal error');
    });

    it('returns stdout, stderr and exitCode from successful execution', async () => {
      mockExeca.mockResolvedValueOnce({ stdout: 'done', stderr: '', exitCode: 0 } as any);

      const result = await adapter.execute({ prompt: 'test', workingDir: '/tmp' });

      expect(result).toEqual({ stdout: 'done', stderr: '', exitCode: 0 });
    });
  });

  describe('review()', () => {
    it('parses valid JSON response into ReviewResult', async () => {
      const reviewJson = JSON.stringify({
        passed: true,
        feedback: 'All good',
        issues: [],
      });
      mockExeca.mockResolvedValueOnce({ stdout: reviewJson, stderr: '', exitCode: 0 } as any);

      const result = await adapter.review({
        artifactPath: '/tmp/file.ts',
        criteria: 'Check quality',
        workingDir: '/tmp',
      });

      expect(result.passed).toBe(true);
      expect(result.feedback).toBe('All good');
      expect(result.issues).toEqual([]);
    });

    it('parses JSON embedded in surrounding text', async () => {
      const output = `Review result:\n{"passed": false, "feedback": "Needs refactor", "issues": [{"severity": "critical", "message": "missing tests"}]}`;
      mockExeca.mockResolvedValueOnce({ stdout: output, stderr: '', exitCode: 0 } as any);

      const result = await adapter.review({
        artifactPath: '/tmp/file.ts',
        criteria: 'Check coverage',
        workingDir: '/tmp',
      });

      expect(result.passed).toBe(false);
      expect(result.feedback).toBe('Needs refactor');
      expect(result.issues[0].severity).toBe('critical');
    });

    it('returns passed=false when output is not parseable JSON', async () => {
      mockExeca.mockResolvedValueOnce({ stdout: 'Unable to review.', stderr: '', exitCode: 0 } as any);

      const result = await adapter.review({
        artifactPath: '/tmp/file.ts',
        criteria: 'Check quality',
        workingDir: '/tmp',
      });

      expect(result.passed).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].severity).toBe('critical');
      expect(result.issues[0].message).toBe('Review output could not be parsed');
    });

    it('does NOT pass --allowedTools in the review execute call', async () => {
      const reviewJson = JSON.stringify({ passed: true, feedback: 'ok', issues: [] });
      mockExeca.mockResolvedValueOnce({ stdout: reviewJson, stderr: '', exitCode: 0 } as any);

      await adapter.review({
        artifactPath: '/tmp/file.ts',
        criteria: 'Check quality',
        workingDir: '/tmp',
      });

      const callArgs = mockExeca.mock.calls[0];
      const args = callArgs[1] as string[];
      expect(args).not.toContain('--allowedTools');
    });
  });
});
