import { writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execa } from 'execa';
import { getPlatform, getOasisConfigDir } from '../utils/platform.js';
import { log } from '../utils/logger.js';
import { loadConfig } from './config.js';
import { listProjects, hasInProgressTask, getNextReadyTask, type TaskFrontmatter } from './vault.js';

// --- Polling Logic ---

export interface SchedulerPollResult {
  readyTasks: Array<{ project: string; task: TaskFrontmatter }>;
  busyProjects: string[];
  idleProjects: string[];
}

export function pollProjects(): SchedulerPollResult {
  const config = loadConfig();
  const projects = listProjects(config.vault);

  const result: SchedulerPollResult = {
    readyTasks: [],
    busyProjects: [],
    idleProjects: [],
  };

  for (const project of projects) {
    if (hasInProgressTask(config.vault, project)) {
      result.busyProjects.push(project);
      continue;
    }

    const nextTask = getNextReadyTask(config.vault, project);
    if (nextTask) {
      result.readyTasks.push({ project, task: nextTask });
    } else {
      result.idleProjects.push(project);
    }
  }

  return result;
}

// --- Platform-Specific Installation ---

function getOasisBinPath(): string {
  // Find the oasis binary. When installed globally via npm, it's in the PATH.
  // We need to resolve the actual path for schedulers.
  const platform = getPlatform();
  if (platform === 'win32') {
    return 'oasis.cmd'; // npm creates .cmd on Windows
  }
  return 'oasis';
}

// macOS: LaunchAgent
function getLaunchdPlistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', 'com.oasis.scheduler.plist');
}

function installLaunchd(intervalMinutes: number): void {
  const plistPath = getLaunchdPlistPath();
  const intervalSeconds = intervalMinutes * 60;
  const logDir = join(getOasisConfigDir(), 'logs');

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.oasis.scheduler</string>
  <key>ProgramArguments</key>
  <array>
    <string>${getOasisBinPath()}</string>
    <string>scheduler</string>
    <string>run</string>
  </array>
  <key>StartInterval</key>
  <integer>${intervalSeconds}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${join(logDir, 'scheduler-stdout.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(logDir, 'scheduler-stderr.log')}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:${join(homedir(), '.npm-global', 'bin')}</string>
  </dict>
</dict>
</plist>`;

  mkdirSync(logDir, { recursive: true });

  writeFileSync(plistPath, plist, 'utf-8');
  log.success(`LaunchAgent written to ${plistPath}`);
}

async function startLaunchd(): Promise<void> {
  const plistPath = getLaunchdPlistPath();
  if (!existsSync(plistPath)) {
    throw new Error('LaunchAgent plist not found. Run install first.');
  }
  await execa('launchctl', ['load', plistPath]);
  log.success('LaunchAgent loaded');
}

async function stopLaunchd(): Promise<void> {
  const plistPath = getLaunchdPlistPath();
  if (existsSync(plistPath)) {
    try {
      await execa('launchctl', ['unload', plistPath]);
    } catch {
      // May not be loaded
    }
    unlinkSync(plistPath);
    log.success('LaunchAgent removed');
  }
}

async function statusLaunchd(): Promise<boolean> {
  try {
    const { stdout } = await execa('launchctl', ['list', 'com.oasis.scheduler']);
    return !stdout.includes('Could not find');
  } catch {
    return false;
  }
}

// Windows: Task Scheduler (user-level, NO admin required)
async function installSchtasks(intervalMinutes: number): Promise<void> {
  const oasisBin = getOasisBinPath();

  try {
    await execa('schtasks', [
      '/create',
      '/tn', 'OasisScheduler',
      '/sc', 'MINUTE',
      '/mo', String(intervalMinutes),
      '/tr', `"${oasisBin}" scheduler run`,
      '/f', // overwrite if exists
    ]);
    log.success('Windows Task Scheduler job created (user-level, no admin)');
  } catch (error: any) {
    throw new Error(`Failed to create scheduled task: ${error.message}`);
  }
}

async function stopSchtasks(): Promise<void> {
  try {
    await execa('schtasks', ['/delete', '/tn', 'OasisScheduler', '/f']);
    log.success('Windows scheduled task removed');
  } catch {
    log.dim('No scheduled task found to remove');
  }
}

async function statusSchtasks(): Promise<boolean> {
  try {
    const { stdout } = await execa('schtasks', ['/query', '/tn', 'OasisScheduler']);
    return stdout.includes('OasisScheduler');
  } catch {
    return false;
  }
}

// Linux: user crontab
async function installCron(intervalMinutes: number): Promise<void> {
  const oasisBin = getOasisBinPath();
  const cronLine = `*/${intervalMinutes} * * * * ${oasisBin} scheduler run`;

  try {
    // Get existing crontab
    let existing = '';
    try {
      const { stdout } = await execa('crontab', ['-l']);
      existing = stdout;
    } catch {
      // No existing crontab
    }

    // Remove any existing oasis line
    const lines = existing.split('\n').filter(l => !l.includes('oasis scheduler'));
    lines.push(cronLine);

    // Write new crontab
    const newCrontab = lines.filter(Boolean).join('\n') + '\n';
    await execa('crontab', ['-'], { input: newCrontab });
    log.success(`Cron job installed: every ${intervalMinutes} minutes`);
  } catch (error: any) {
    throw new Error(`Failed to install cron: ${error.message}`);
  }
}

async function stopCron(): Promise<void> {
  try {
    const { stdout } = await execa('crontab', ['-l']);
    const lines = stdout.split('\n').filter(l => !l.includes('oasis scheduler'));
    const newCrontab = lines.filter(Boolean).join('\n') + '\n';
    await execa('crontab', ['-'], { input: newCrontab });
    log.success('Cron job removed');
  } catch {
    log.dim('No cron job found to remove');
  }
}

async function statusCron(): Promise<boolean> {
  try {
    const { stdout } = await execa('crontab', ['-l']);
    return stdout.includes('oasis scheduler');
  } catch {
    return false;
  }
}

// --- Public API ---

export async function installScheduler(intervalMinutes: number): Promise<void> {
  const platform = getPlatform();

  switch (platform) {
    case 'darwin':
      installLaunchd(intervalMinutes);
      await startLaunchd();
      break;
    case 'win32':
      await installSchtasks(intervalMinutes);
      break;
    case 'linux':
      await installCron(intervalMinutes);
      break;
  }
}

export async function removeScheduler(): Promise<void> {
  const platform = getPlatform();

  switch (platform) {
    case 'darwin':
      await stopLaunchd();
      break;
    case 'win32':
      await stopSchtasks();
      break;
    case 'linux':
      await stopCron();
      break;
  }
}

export async function isSchedulerActive(): Promise<boolean> {
  const platform = getPlatform();

  switch (platform) {
    case 'darwin':
      return statusLaunchd();
    case 'win32':
      return statusSchtasks();
    case 'linux':
      return statusCron();
  }
}
