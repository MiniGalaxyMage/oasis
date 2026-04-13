import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ClaudeAdapter } from './claude.js';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import { execa } from 'execa';

const mockExeca = vi.mocked(execa);

describe('ClaudeAdapter', () => {
  let adapter: ClaudeAdapter;

  beforeEach(() => {
    adapter = new ClaudeAdapter();
    vi.clearAllMocks();
  });

  describe('isAvailable()', () => {
    it('returns true when claude --version succeeds', async () => {
      mockExeca.mockResolvedValueOnce({ stdout: '1.0.0', stderr: '', exitCode: 0 } as any);

      const result = await adapter.isAvailable();

      expect(result).toBe(true);
      expect(mockExeca).toHaveBeenCalledWith('claude', ['--version']);
    });

    it('returns false when command not found', async () => {
      mockExeca.mockRejectedValueOnce(new Error('command not found: claude'));

      const result = await adapter.isAvailable();

      expect(result).toBe(false);
    });
  });

  describe('getVersion()', () => {
    it('returns trimmed version string from stdout', async () => {
      mockExeca.mockResolvedValueOnce({ stdout: '  1.2.3  ', stderr: '', exitCode: 0 } as any);

      const result = await adapter.getVersion();

      expect(result).toBe('1.2.3');
    });

    it('returns "unknown" when command fails', async () => {
      mockExeca.mockRejectedValueOnce(new Error('command not found'));

      const result = await adapter.getVersion();

      expect(result).toBe('unknown');
    });
  });

  describe('execute()', () => {
    it('builds correct args with -p prompt', async () => {
      mockExeca.mockResolvedValueOnce({ stdout: 'output', stderr: '', exitCode: 0 } as any);

      await adapter.execute({ prompt: 'test', workingDir: '/tmp' });

      expect(mockExeca).toHaveBeenCalledWith(
        'claude',
        ['-p', 'test'],
        expect.objectContaining({ cwd: '/tmp' }),
      );
    });

    it('adds --allowedTools when provided', async () => {
      mockExeca.mockResolvedValueOnce({ stdout: 'output', stderr: '', exitCode: 0 } as any);

      await adapter.execute({ prompt: 'test', workingDir: '/tmp', allowedTools: ['Read', 'Write'] });

      expect(mockExeca).toHaveBeenCalledWith(
        'claude',
        ['-p', 'test', '--allowedTools', 'Read,Write'],
        expect.objectContaining({ cwd: '/tmp' }),
      );
    });

    it('adds --model when provided', async () => {
      mockExeca.mockResolvedValueOnce({ stdout: 'output', stderr: '', exitCode: 0 } as any);

      await adapter.execute({ prompt: 'test', workingDir: '/tmp', model: 'claude-opus-4' });

      expect(mockExeca).toHaveBeenCalledWith(
        'claude',
        ['-p', 'test', '--model', 'claude-opus-4'],
        expect.objectContaining({ cwd: '/tmp' }),
      );
    });

    it('adds extra flags when provided', async () => {
      mockExeca.mockResolvedValueOnce({ stdout: 'output', stderr: '', exitCode: 0 } as any);

      await adapter.execute({ prompt: 'test', workingDir: '/tmp', flags: ['--verbose', '--dangerouslySkipPermissions'] });

      expect(mockExeca).toHaveBeenCalledWith(
        'claude',
        ['-p', 'test', '--verbose', '--dangerouslySkipPermissions'],
        expect.objectContaining({ cwd: '/tmp' }),
      );
    });

    it('returns exitCode 1 on error', async () => {
      const error: any = new Error('process failed');
      error.stdout = 'partial output';
      error.stderr = 'some error';
      error.exitCode = 1;
      mockExeca.mockRejectedValueOnce(error);

      const result = await adapter.execute({ prompt: 'test', workingDir: '/tmp' });

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('partial output');
      expect(result.stderr).toBe('some error');
    });

    it('returns exitCode 1 with error message in stderr when error has no exitCode', async () => {
      const error: any = new Error('unexpected failure');
      mockExeca.mockRejectedValueOnce(error);

      const result = await adapter.execute({ prompt: 'test', workingDir: '/tmp' });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('unexpected failure');
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
        feedback: 'Looks good',
        issues: [],
      });
      mockExeca.mockResolvedValueOnce({ stdout: reviewJson, stderr: '', exitCode: 0 } as any);

      const result = await adapter.review({
        artifactPath: '/tmp/file.ts',
        criteria: 'Check quality',
        workingDir: '/tmp',
      });

      expect(result.passed).toBe(true);
      expect(result.feedback).toBe('Looks good');
      expect(result.issues).toEqual([]);
    });

    it('parses JSON embedded in surrounding text', async () => {
      const output = `Here is my review:\n{"passed": false, "feedback": "Needs work", "issues": [{"severity": "warning", "message": "missing types"}]}\nEnd of review.`;
      mockExeca.mockResolvedValueOnce({ stdout: output, stderr: '', exitCode: 0 } as any);

      const result = await adapter.review({
        artifactPath: '/tmp/file.ts',
        criteria: 'Check types',
        workingDir: '/tmp',
      });

      expect(result.passed).toBe(false);
      expect(result.feedback).toBe('Needs work');
      expect(result.issues[0].severity).toBe('warning');
    });

    it('returns passed=false when output is not parseable JSON', async () => {
      mockExeca.mockResolvedValueOnce({ stdout: 'I cannot review this file.', stderr: '', exitCode: 0 } as any);

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

    it('passes allowedTools Read and correct model to execute', async () => {
      const reviewJson = JSON.stringify({ passed: true, feedback: 'ok', issues: [] });
      mockExeca.mockResolvedValueOnce({ stdout: reviewJson, stderr: '', exitCode: 0 } as any);

      await adapter.review({
        artifactPath: '/tmp/file.ts',
        criteria: 'Check quality',
        workingDir: '/tmp',
        model: 'claude-sonnet-4',
      });

      expect(mockExeca).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['-p', expect.stringContaining('/tmp/file.ts'), '--allowedTools', 'Read', '--model', 'claude-sonnet-4']),
        expect.objectContaining({ cwd: '/tmp' }),
      );
    });
  });
});
