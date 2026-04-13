import { describe, it, expect } from 'vitest';
import { execa } from 'execa';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', '..', 'src', 'index.ts');
const ROOT = join(__dirname, '..', '..');

async function runCli(...args: string[]) {
  try {
    const result = await execa('npx', ['tsx', CLI, ...args], {
      timeout: 15_000,
      cwd: ROOT,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode ?? 0 };
  } catch (error: any) {
    return { stdout: error.stdout ?? '', stderr: error.stderr ?? '', exitCode: error.exitCode ?? 1 };
  }
}

describe('CLI E2E', () => {
  it('--version prints version number', async () => {
    const { stdout } = await runCli('--version');
    expect(stdout).toContain('0.1.0');
  });

  it('--help shows all top-level commands', async () => {
    const { stdout } = await runCli('--help');
    expect(stdout).toContain('init');
    expect(stdout).toContain('task');
    expect(stdout).toContain('scheduler');
    expect(stdout).toContain('wiki');
    expect(stdout).toContain('briefing');
    expect(stdout).toContain('project');
  });

  it('task --help shows all subcommands', async () => {
    const { stdout } = await runCli('task', '--help');
    expect(stdout).toContain('new');
    expect(stdout).toContain('list');
    expect(stdout).toContain('context');
    expect(stdout).toContain('dev');
    expect(stdout).toContain('review');
    expect(stdout).toContain('deploy');
    expect(stdout).toContain('close');
  });

  it('scheduler --help shows all subcommands', async () => {
    const { stdout } = await runCli('scheduler', '--help');
    expect(stdout).toContain('start');
    expect(stdout).toContain('stop');
    expect(stdout).toContain('status');
    expect(stdout).toContain('run');
  });

  it('wiki --help shows all subcommands', async () => {
    const { stdout } = await runCli('wiki', '--help');
    expect(stdout).toContain('ingest');
    expect(stdout).toContain('query');
    expect(stdout).toContain('lint');
  });

  it('project --help shows all subcommands', async () => {
    const { stdout } = await runCli('project', '--help');
    expect(stdout).toContain('new');
    expect(stdout).toContain('list');
  });

  it('unknown command shows error', async () => {
    const { stdout, stderr } = await runCli('nonexistent');
    // Commander may output to stdout or stderr depending on version
    const output = stdout + stderr;
    expect(output).toContain('unknown command');
  });
});
