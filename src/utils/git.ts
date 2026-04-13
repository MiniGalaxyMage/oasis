import { execa } from 'execa';

export async function isGitInstalled(): Promise<boolean> {
  try {
    await execa('git', ['--version']);
    return true;
  } catch {
    return false;
  }
}

export async function getGitVersion(): Promise<string> {
  const { stdout } = await execa('git', ['--version']);
  const match = stdout.match(/(\d+\.\d+\.\d+)/);
  return match?.[1] ?? 'unknown';
}

export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await execa('git', ['rev-parse', '--git-dir'], { cwd: dir });
    return true;
  } catch {
    return false;
  }
}

export async function getCurrentBranch(dir: string): Promise<string> {
  const { stdout } = await execa('git', ['branch', '--show-current'], { cwd: dir });
  return stdout.trim();
}

export async function createBranch(dir: string, name: string): Promise<void> {
  await execa('git', ['checkout', '-b', name], { cwd: dir });
}

export async function hasStagedChanges(dir: string): Promise<boolean> {
  const { stdout } = await execa('git', ['diff', '--cached', '--name-only'], { cwd: dir });
  return stdout.trim().length > 0;
}

export async function hasUncommittedChanges(dir: string): Promise<boolean> {
  const { stdout } = await execa('git', ['status', '--porcelain'], { cwd: dir });
  return stdout.trim().length > 0;
}
