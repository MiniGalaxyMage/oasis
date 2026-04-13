import { execa } from 'execa';
import type { ProviderAdapter, ExecuteOptions, ExecuteResult, ReviewOptions, ReviewResult } from './adapter.js';

const MINIMAX_API_URL = 'https://api.minimax.io/v1/text/chatcompletion_v2';

export class MinimaxAdapter implements ProviderAdapter {
  name = 'minimax';

  async isAvailable(): Promise<boolean> {
    // Check if MINIMAX_API_KEY is set in environment
    const apiKey = process.env.MINIMAX_API_KEY ?? process.env.MINIMAX_API_TOKEN;
    if (!apiKey) return false;

    // Verify we can reach the API with a lightweight call
    try {
      const response = await fetch(`${MINIMAX_API_URL}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'MiniMax-M2.7',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 2,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      return response.ok || response.status === 400; // 400 = auth ok but bad request (ping rejected)
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string> {
    const apiKey = process.env.MINIMAX_API_KEY ?? process.env.MINIMAX_API_TOKEN ?? '';
    const masked = apiKey ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : 'no-key';
    return `minimax adapter (key: ${masked})`;
  }

  async execute(opts: ExecuteOptions): Promise<ExecuteResult> {
    const apiKey = process.env.MINIMAX_API_KEY ?? process.env.MINIMAX_API_TOKEN ?? '';

    const model = opts.model ?? 'MiniMax-M2.7';

    // Build messages array: system prompt baked into first user message if provided
    const messages: Array<{ role: string; content: string }> = [];
    
    if (opts.flags?.includes('--no-system')) {
      messages.push({ role: 'user', content: opts.prompt });
    } else {
      // Default: wrap prompt as user message
      messages.push({ role: 'user', content: opts.prompt });
    }

    const requestBody = {
      model,
      messages,
      max_tokens: 4096,
    };

    try {
      const response = await fetch(MINIMAX_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(600_000), // 10 min
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          stdout: '',
          stderr: `MiniMax API error ${response.status}: ${errorText}`,
          exitCode: 1,
        };
      }

      const data = await response.json() as any;
      const content = data.choices?.[0]?.messages?.[0]?.content
        ?? data.choices?.[0]?.text
        ?? '';

      return {
        stdout: content,
        stderr: '',
        exitCode: 0,
      };
    } catch (error: any) {
      return {
        stdout: '',
        stderr: error.message ?? 'Unknown error',
        exitCode: 1,
      };
    }
  }

  async review(opts: ReviewOptions): Promise<ReviewResult> {
    const reviewPrompt = `Review the following artifact. Read the file at ${opts.artifactPath} and evaluate it against these criteria:

${opts.criteria}

Respond in this exact JSON format:
{
  "passed": true/false,
  "feedback": "overall assessment",
  "issues": [{"severity": "critical|warning|suggestion", "message": "description", "location": "optional file:line"}]
}

Be strict. Only pass if quality is genuinely high.`;

    const result = await this.execute({
      prompt: reviewPrompt,
      workingDir: opts.workingDir,
      model: opts.model,
    });

    try {
      const jsonMatch = result.stdout.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as ReviewResult;
      }
    } catch {
      // parsing failed
    }

    return {
      passed: false,
      feedback: result.stdout || 'Review failed to produce parseable output',
      issues: [{
        severity: 'critical',
        message: 'Review output could not be parsed',
      }],
    };
  }
}
