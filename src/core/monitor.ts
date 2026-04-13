import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import YAML from 'yaml';
import matter from 'gray-matter';
import { log } from '../utils/logger.js';
import { getProviderAdapter } from '../providers/index.js';
import type { OasisConfig } from './config.js';

// --- Types ---

export interface ObservabilityConfig {
  health_endpoints: HealthEndpoint[];
  log_command?: string;
  rollback_command?: string;
  monitor_interval_seconds: number;
  max_failures_before_rollback: number;
}

export interface HealthEndpoint {
  name: string;
  url: string;
  expected_status?: number;
  timeout_ms?: number;
}

export interface HealthCheckResult {
  endpoint: HealthEndpoint;
  healthy: boolean;
  status?: number;
  responseTime?: number;
  error?: string;
}

export interface MonitorCycleResult {
  timestamp: string;
  allHealthy: boolean;
  checks: HealthCheckResult[];
  consecutiveFailures: number;
  action: 'ok' | 'warning' | 'rollback' | 'triage';
}

// --- Health Checking ---

export async function checkHealth(endpoint: HealthEndpoint): Promise<HealthCheckResult> {
  const timeout = endpoint.timeout_ms ?? 5000;
  const expectedStatus = endpoint.expected_status ?? 200;

  try {
    const start = Date.now();
    const result = await execa('curl', [
      '-sf',
      '-o', '/dev/null',
      '-w', '%{http_code}',
      '--max-time', String(Math.ceil(timeout / 1000)),
      endpoint.url,
    ], { timeout: timeout + 2000 });

    const status = parseInt(result.stdout.trim(), 10);
    const responseTime = Date.now() - start;

    return {
      endpoint,
      healthy: status === expectedStatus,
      status,
      responseTime,
    };
  } catch (error: any) {
    return {
      endpoint,
      healthy: false,
      error: error.message ?? 'Health check failed',
    };
  }
}

export async function checkAllHealth(
  endpoints: HealthEndpoint[],
): Promise<HealthCheckResult[]> {
  return Promise.all(endpoints.map(checkHealth));
}

// --- Rollback ---

export async function executeRollback(
  rollbackCommand: string,
  workingDir: string,
): Promise<boolean> {
  log.error('Circuit breaker triggered — executing rollback...');

  try {
    const parts = rollbackCommand.split(' ');
    await execa(parts[0], parts.slice(1), {
      cwd: workingDir,
      stdio: 'inherit',
    });
    log.success('Rollback completed successfully');
    return true;
  } catch (error: any) {
    log.error(`Rollback FAILED: ${error.message}`);
    return false;
  }
}

// --- Auto-Triage ---

export async function autoTriage(
  projectName: string,
  checks: HealthCheckResult[],
  config: OasisConfig,
  logOutput?: string,
): Promise<string | null> {
  const failedChecks = checks.filter(c => !c.healthy);
  if (failedChecks.length === 0) return null;

  const providerName = config.providers.default as string;
  const provider = getProviderAdapter(providerName);

  if (!(await provider.isAvailable())) {
    log.warn('AI provider not available for auto-triage. Creating basic ticket.');
    return createBasicTriageTask(projectName, failedChecks, config);
  }

  log.step('Running AI-powered auto-triage...');

  const failureDetails = failedChecks.map(c =>
    `- ${c.endpoint.name} (${c.endpoint.url}): ${c.error ?? `status ${c.status}`}`,
  ).join('\n');

  const prompt = `You are a production incident triage engineer. Analyze these health check failures and generate a structured incident report.

## Project: ${projectName}
## Timestamp: ${new Date().toISOString()}

## Failed Health Checks
${failureDetails}

${logOutput ? `## Recent Logs\n${logOutput}` : ''}

## Instructions

Analyze the failures and produce a triage report with:
1. **Severity**: critical / high / medium / low
2. **Impact**: what users/systems are affected
3. **Probable Root Cause**: based on the failure pattern
4. **Suggested Investigation**: specific steps to diagnose
5. **Suggested Fix**: if the cause is obvious

Be concise and actionable. Output ONLY the report, no preamble.`;

  const result = await provider.execute({
    prompt,
    workingDir: join(config.vault, 'projects', projectName),
  });

  if (result.exitCode === 0 && result.stdout.trim()) {
    return createTriageTask(projectName, failedChecks, result.stdout, config);
  }

  return createBasicTriageTask(projectName, failedChecks, config);
}

function createBasicTriageTask(
  projectName: string,
  failedChecks: HealthCheckResult[],
  config: OasisConfig,
): string {
  const failures = failedChecks.map(c => `${c.endpoint.name}: ${c.error ?? `status ${c.status}`}`).join(', ');

  return createTriageTask(projectName, failedChecks, `Health check failures detected: ${failures}. Manual investigation required.`, config);
}

function createTriageTask(
  projectName: string,
  failedChecks: HealthCheckResult[],
  triageReport: string,
  config: OasisConfig,
): string {
  const id = `TRIAGE-${Date.now()}`;
  const now = new Date().toISOString().split('T')[0];

  const frontmatterData = {
    id,
    title: `[Auto-Triage] Health check failures in ${projectName}`,
    status: 'ready',
    project: projectName,
    priority: 'critical',
    created: now,
    tags: ['auto-triage', 'incident', 'production'],
    complexity: 'medium',
    branch: '',
  };

  const body = `
## Description

Auto-generated triage task from post-deploy monitoring.

### Failed Health Checks
${failedChecks.map(c => `- **${c.endpoint.name}** (${c.endpoint.url}): ${c.error ?? `HTTP ${c.status}`}${c.responseTime ? ` (${c.responseTime}ms)` : ''}`).join('\n')}

### AI Triage Report
${triageReport}

## Acceptance Criteria
- [ ] Root cause identified
- [ ] Fix implemented and deployed
- [ ] Health checks passing
- [ ] Post-mortem documented in decisions/

## Context Notes

## SDD Artifacts

## Review Notes

## Deploy Log
`;

  const content = matter.stringify(body, frontmatterData);

  const backlogDir = join(config.vault, 'projects', projectName, 'backlog');
  if (!existsSync(backlogDir)) {
    mkdirSync(backlogDir, { recursive: true });
  }

  const taskPath = join(backlogDir, `${id}.md`);
  writeFileSync(taskPath, content, 'utf-8');

  // Append to vault log
  const logPath = join(config.vault, 'log.md');
  if (existsSync(logPath)) {
    const logContent = readFileSync(logPath, 'utf-8');
    const entry = `\n## [${now}] auto-triage | ${projectName}/${id}\n- **Health check failures detected**\n- Failed endpoints: ${failedChecks.map(c => c.endpoint.name).join(', ')}\n`;
    writeFileSync(logPath, logContent + entry, 'utf-8');
  }

  return taskPath;
}

// --- Monitor Loop ---

export function loadObservabilityConfig(
  vaultPath: string,
  projectName: string,
): ObservabilityConfig | null {
  const projectYamlPath = join(vaultPath, 'projects', projectName, 'project.yaml');
  if (!existsSync(projectYamlPath)) return null;

  const raw = readFileSync(projectYamlPath, 'utf-8');
  const config = YAML.parse(raw);
  const obs = config?.observability;
  if (!obs?.health_endpoints?.length) return null;

  return {
    health_endpoints: obs.health_endpoints,
    log_command: obs.log_command,
    rollback_command: obs.rollback_command,
    monitor_interval_seconds: obs.monitor_interval_seconds ?? 60,
    max_failures_before_rollback: obs.max_failures_before_rollback ?? 3,
  };
}

export async function runMonitorCycle(
  projectName: string,
  obsConfig: ObservabilityConfig,
  oasisConfig: OasisConfig,
  consecutiveFailures: number,
  workingDir: string,
): Promise<MonitorCycleResult> {
  const checks = await checkAllHealth(obsConfig.health_endpoints);
  const allHealthy = checks.every(c => c.healthy);
  const timestamp = new Date().toISOString();

  if (allHealthy) {
    return {
      timestamp,
      allHealthy: true,
      checks,
      consecutiveFailures: 0,
      action: 'ok',
    };
  }

  const newFailureCount = consecutiveFailures + 1;

  // Circuit breaker: auto-rollback after N consecutive failures
  if (newFailureCount >= obsConfig.max_failures_before_rollback && obsConfig.rollback_command) {
    log.error(`${newFailureCount} consecutive failures — triggering circuit breaker`);
    await executeRollback(obsConfig.rollback_command, workingDir);

    // Create triage task
    let logOutput: string | undefined;
    if (obsConfig.log_command) {
      try {
        const parts = obsConfig.log_command.split(' ');
        const logResult = await execa(parts[0], parts.slice(1), { cwd: workingDir, timeout: 10_000 });
        logOutput = logResult.stdout;
      } catch {
        // logs not available
      }
    }

    await autoTriage(projectName, checks, oasisConfig, logOutput);

    return {
      timestamp,
      allHealthy: false,
      checks,
      consecutiveFailures: newFailureCount,
      action: 'rollback',
    };
  }

  // Warning zone: failing but not yet at rollback threshold
  if (newFailureCount >= 2) {
    log.warn(`${newFailureCount}/${obsConfig.max_failures_before_rollback} consecutive failures`);

    return {
      timestamp,
      allHealthy: false,
      checks,
      consecutiveFailures: newFailureCount,
      action: 'warning',
    };
  }

  // First failure: just note it
  return {
    timestamp,
    allHealthy: false,
    checks,
    consecutiveFailures: newFailureCount,
    action: 'triage',
  };
}
