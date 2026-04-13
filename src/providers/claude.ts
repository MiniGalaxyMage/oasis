import { execa } from 'execa';
import type { ProviderAdapter, ExecuteOptions, ExecuteResult, ReviewOptions, ReviewResult } from './adapter.js';

export class ClaudeAdapter implements ProviderAdapter {
  name = 'claude';

  async isAvailable(): Promise<boolean> {
    try {
      await execa('claude', ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string> {
    try {
      const { stdout } = await execa('claude', ['--version']);
      return stdout.trim();
    } catch {
      return 'unknown';
    }
  }

  async execute(opts: ExecuteOptions): Promise<ExecuteResult> {
    const args: string[] = ['-p', opts.prompt];

    if (opts.allowedTools?.length) {
      args.push('--allowedTools', opts.allowedTools.join(','));
    }

    if (opts.model) {
      args.push('--model', opts.model);
    }

    if (opts.flags) {
      args.push(...opts.flags);
    }

    try {
      const result = await execa('claude', args, {
        cwd: opts.workingDir,
        timeout: 600_000, // 10 min timeout
      });
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode ?? 0,
      };
    } catch (error: any) {
      return {
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? error.message,
        exitCode: error.exitCode ?? 1,
      };
    }
  }

  async review(opts: ReviewOptions): Promise<ReviewResult> {
    const prompt = `Review the following artifact critically. Read the file at ${opts.artifactPath} and evaluate it against these criteria:

${opts.criteria}

Respond in this exact JSON format:
{
  "passed": true/false,
  "feedback": "overall assessment",
  "issues": [{"severity": "critical|warning|suggestion", "message": "description", "location": "optional file:line"}]
}

Be strict. Only pass if quality is genuinely high.`;

    const result = await this.execute({
      prompt,
      workingDir: opts.workingDir,
      allowedTools: ['Read'],
      model: opts.model,
    });

    try {
      // Try to parse JSON from the output
      const jsonMatch = result.stdout.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as ReviewResult;
      }
    } catch {
      // If parsing fails, treat as failed review
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
