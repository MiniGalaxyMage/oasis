import { execa } from 'execa';
import type { ProviderAdapter, ExecuteOptions, ExecuteResult, ReviewOptions, ReviewResult } from './adapter.js';

const MINIMAX_API_URL = 'https://api.minimax.io/v1/text/chatcompletion_v2';

export class MinimaxAdapter implements ProviderAdapter {
  name = 'minimax';

  async isAvailable(): Promise<boolean> {
    // Check only that API key is configured — consistent with other adapters
    // (claude/codex just check local binary availability without remote calls).
    // API errors are surfaced at execute() time.
    return Boolean(process.env.MINIMAX_API_KEY ?? process.env.MINIMAX_API_TOKEN);
  }

  async getVersion(): Promise<string> {
    const apiKey = process.env.MINIMAX_API_KEY ?? process.env.MINIMAX_API_TOKEN ?? '';
    const masked = apiKey ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : 'no-key';
    return `minimax adapter (key: ${masked})`;
  }

  async execute(opts: ExecuteOptions): Promise<ExecuteResult> {
    const apiKey = process.env.MINIMAX_API_KEY ?? process.env.MINIMAX_API_TOKEN ?? '';

    const model = opts.model ?? 'MiniMax-M2.7';

    const messages: Array<{ role: string; content: string }> = [
      { role: 'user', content: opts.prompt },
    ];

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
      // MiniMax may use either OpenAI-style `message.content` (singular)
      // or its own `messages[0].content` (plural). Try both.
      const content = data.choices?.[0]?.message?.content
        ?? data.choices?.[0]?.messages?.[0]?.content
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
