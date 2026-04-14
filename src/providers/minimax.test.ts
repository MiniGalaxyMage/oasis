import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MinimaxAdapter } from './minimax.js';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe('MinimaxAdapter', () => {
  let adapter: MinimaxAdapter;

  beforeEach(() => {
    adapter = new MinimaxAdapter();
    vi.clearAllMocks();
    // Reset env for each test
    delete process.env.MINIMAX_API_KEY;
    delete process.env.MINIMAX_API_TOKEN;
  });

  describe('isAvailable()', () => {
    it('returns false when no API key is set', async () => {
      const result = await adapter.isAvailable();
      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns true when MINIMAX_API_KEY is set', async () => {
      process.env.MINIMAX_API_KEY = 'test-key-123';

      const result = await adapter.isAvailable();

      expect(result).toBe(true);
      // Should NOT make a remote call — consistent with claude/codex adapters
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns true when MINIMAX_API_TOKEN is set (fallback)', async () => {
      process.env.MINIMAX_API_TOKEN = 'test-key-456';

      const result = await adapter.isAvailable();

      expect(result).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('getVersion()', () => {
    it('returns masked key when API key is set', async () => {
      process.env.MINIMAX_API_KEY = 'secret12345';

      const result = await adapter.getVersion();

      expect(result).toBe('minimax adapter (key: secr...2345)');
    });

    it('returns "no-key" when no API key is set', async () => {
      const result = await adapter.getVersion();
      expect(result).toBe('minimax adapter (key: no-key)');
    });

    it('prefers MINIMAX_API_KEY over MINIMAX_API_TOKEN', async () => {
      process.env.MINIMAX_API_KEY = 'primary';
      process.env.MINIMAX_API_TOKEN = 'secondary';

      const result = await adapter.getVersion();

      expect(result).toContain('prim...mary');
    });
  });

  describe('execute()', () => {
    it('returns stdout from OpenAI-style response (message.content)', async () => {
      process.env.MINIMAX_API_KEY = 'test-key';
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: 'hello from minimax' } }],
      }), { status: 200 }) as any);

      const result = await adapter.execute({
        prompt: 'say hello',
        workingDir: '/tmp',
      });

      expect(result.stdout).toBe('hello from minimax');
      expect(result.exitCode).toBe(0);
    });

    it('returns stdout from legacy response shape (messages[0].content)', async () => {
      process.env.MINIMAX_API_KEY = 'test-key';
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ messages: [{ content: 'legacy shape' }] }],
      }), { status: 200 }) as any);

      const result = await adapter.execute({
        prompt: 'say hello',
        workingDir: '/tmp',
      });

      expect(result.stdout).toBe('legacy shape');
      expect(result.exitCode).toBe(0);
    });

    it('returns stderr when API returns error', async () => {
      process.env.MINIMAX_API_KEY = 'test-key';
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: 'invalid request' },
      }), { status: 400 }) as any);

      const result = await adapter.execute({
        prompt: 'say hello',
        workingDir: '/tmp',
      });

      expect(result.stdout).toBe('');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('400');
    });

    it('uses model from opts when provided', async () => {
      process.env.MINIMAX_API_KEY = 'test-key';
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: 'output' } }],
      }), { status: 200 }) as any);

      await adapter.execute({
        prompt: 'test',
        workingDir: '/tmp',
        model: 'MiniMax-M2.1',
      });

      const fetchCall = mockFetch.mock.calls[0] as [string, any];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.model).toBe('MiniMax-M2.1');
    });

    it('defaults to MiniMax-M2.7 when no model specified', async () => {
      process.env.MINIMAX_API_KEY = 'test-key';
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: 'output' } }],
      }), { status: 200 }) as any);

      await adapter.execute({
        prompt: 'test',
        workingDir: '/tmp',
      });

      const fetchCall = mockFetch.mock.calls[0] as [string, any];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.model).toBe('MiniMax-M2.7');
    });

    it('returns stderr when fetch throws', async () => {
      process.env.MINIMAX_API_KEY = 'test-key';
      mockFetch.mockRejectedValueOnce(new Error('connection refused'));

      const result = await adapter.execute({
        prompt: 'test',
        workingDir: '/tmp',
      });

      expect(result.stdout).toBe('');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('connection refused');
    });

    it('sends Authorization header with Bearer token', async () => {
      process.env.MINIMAX_API_KEY = 'my-secret-key';
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' } }],
      }), { status: 200 }) as any);

      await adapter.execute({ prompt: 'test', workingDir: '/tmp' });

      const fetchCall = mockFetch.mock.calls[0] as [string, any];
      expect(fetchCall[1].headers['Authorization']).toBe('Bearer my-secret-key');
    });
  });

  describe('review()', () => {
    it('returns parsed ReviewResult from API', async () => {
      process.env.MINIMAX_API_KEY = 'test-key';
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          passed: true,
          feedback: 'looks good',
          issues: [],
        }) } }],
      }), { status: 200 }) as any);

      const result = await adapter.review({
        artifactPath: '/tmp/test.ts',
        criteria: 'no syntax errors',
        workingDir: '/tmp',
      });

      expect(result.passed).toBe(true);
      expect(result.feedback).toBe('looks good');
      expect(result.issues).toEqual([]);
    });

    it('returns failed review when JSON cannot be parsed', async () => {
      process.env.MINIMAX_API_KEY = 'test-key';
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: 'not json output' } }],
      }), { status: 200 }) as any);

      const result = await adapter.review({
        artifactPath: '/tmp/test.ts',
        criteria: 'no errors',
        workingDir: '/tmp',
      });

      expect(result.passed).toBe(false);
      expect(result.issues[0].severity).toBe('critical');
    });
  });
});
