import { execa } from 'execa';
import type { ProviderAdapter, ExecuteOptions, ExecuteResult, ReviewOptions, ReviewResult } from './adapter.js';

export class CodexAdapter implements ProviderAdapter {
  name = 'codex';

  async isAvailable(): Promise<boolean> {
    try {
      await execa('codex', ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string> {
    try {
      const { stdout } = await execa('codex', ['--version']);
      return stdout.trim();
    } catch {
      return 'unknown';
    }
  }

  async execute(opts: ExecuteOptions): Promise<ExecuteResult> {
    const args: string[] = ['-q', opts.prompt];

    if (opts.model) {
      args.push('--model', opts.model);
    }

    if (opts.flags) {
      args.push(...opts.flags);
    }

    try {
      const result = await execa('codex', args, {
        cwd: opts.workingDir,
        timeout: 600_000,
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
    const prompt = `Review the following artifact critically. Read the file at ${opts.artifactPath} and evaluate against:

${opts.criteria}

Respond in JSON: {"passed": bool, "feedback": "text", "issues": [{"severity": "critical|warning|suggestion", "message": "text"}]}`;

    const result = await this.execute({
      prompt,
      workingDir: opts.workingDir,
      model: opts.model,
    });

    try {
      const jsonMatch = result.stdout.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as ReviewResult;
      }
    } catch {
      // fallthrough
    }

    return {
      passed: false,
      feedback: result.stdout || 'Review failed',
      issues: [{ severity: 'critical', message: 'Review output could not be parsed' }],
    };
  }
}
