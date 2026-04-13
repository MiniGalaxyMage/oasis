import { Command } from 'commander';
import { log } from '../utils/logger.js';
import { loadConfig } from '../core/config.js';
import {
  loadObservabilityConfig,
  checkAllHealth,
  runMonitorCycle,
  autoTriage,
} from '../core/monitor.js';

export const monitorCommand = new Command('monitor')
  .description('Post-deploy monitoring and self-healing');

monitorCommand
  .command('check <project>')
  .description('Run a single health check cycle for a project')
  .action(async (project: string) => {
    const config = loadConfig();
    const obsConfig = loadObservabilityConfig(config.vault, project);

    if (!obsConfig) {
      log.error(`No observability config for project "${project}".`);
      log.dim('Add an observability section to projects/' + project + '/project.yaml');
      log.dim('Example:');
      log.dim('  observability:');
      log.dim('    health_endpoints:');
      log.dim('      - name: api');
      log.dim('        url: https://api.example.com/health');
      return;
    }

    log.header(`Health Check: ${project}`);

    const checks = await checkAllHealth(obsConfig.health_endpoints);

    for (const check of checks) {
      if (check.healthy) {
        const time = check.responseTime ? ` (${check.responseTime}ms)` : '';
        log.success(`${check.endpoint.name}: healthy${time}`);
      } else {
        log.error(`${check.endpoint.name}: UNHEALTHY — ${check.error ?? `HTTP ${check.status}`}`);
      }
    }

    const allHealthy = checks.every(c => c.healthy);
    if (allHealthy) {
      log.success('\nAll endpoints healthy');
    } else {
      const failed = checks.filter(c => !c.healthy).length;
      log.error(`\n${failed}/${checks.length} endpoints failing`);
    }
  });

monitorCommand
  .command('watch <project>')
  .description('Continuous monitoring with auto-rollback and auto-triage')
  .option('-d, --dir <dir>', 'Project working directory', process.cwd())
  .option('-c, --cycles <n>', 'Number of cycles (0 = infinite)', '0')
  .action(async (project: string, opts: { dir: string; cycles: string }) => {
    const config = loadConfig();
    const obsConfig = loadObservabilityConfig(config.vault, project);

    if (!obsConfig) {
      log.error(`No observability config for project "${project}".`);
      return;
    }

    const maxCycles = parseInt(opts.cycles, 10);
    const intervalMs = obsConfig.monitor_interval_seconds * 1000;

    log.header(`Monitoring: ${project}`);
    log.info(`Interval: ${obsConfig.monitor_interval_seconds}s`);
    log.info(`Circuit breaker: ${obsConfig.max_failures_before_rollback} consecutive failures`);
    log.info(`Rollback: ${obsConfig.rollback_command ?? 'not configured'}`);
    log.dim('Press Ctrl+C to stop\n');

    let cycle = 0;
    let consecutiveFailures = 0;

    const runCycle = async () => {
      cycle++;
      const timestamp = new Date().toLocaleTimeString();
      log.dim(`[${timestamp}] Cycle ${cycle}...`);

      const result = await runMonitorCycle(
        project,
        obsConfig,
        config,
        consecutiveFailures,
        opts.dir,
      );

      consecutiveFailures = result.consecutiveFailures;

      switch (result.action) {
        case 'ok':
          log.success(`  All healthy (${result.checks.length} endpoints)`);
          break;
        case 'warning':
          log.warn(`  ${consecutiveFailures} consecutive failures — approaching circuit breaker`);
          break;
        case 'rollback':
          log.error('  CIRCUIT BREAKER TRIGGERED — rollback executed, triage task created');
          consecutiveFailures = 0; // Reset after rollback
          break;
        case 'triage':
          log.warn('  First failure detected — monitoring...');
          break;
      }
    };

    // Run first cycle immediately
    await runCycle();

    // Continue if not a one-shot
    if (maxCycles === 1) return;

    const remaining = maxCycles > 0 ? maxCycles - 1 : Infinity;
    let ran = 0;

    const interval = setInterval(async () => {
      ran++;
      await runCycle();
      if (ran >= remaining) {
        clearInterval(interval);
      }
    }, intervalMs);

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      clearInterval(interval);
      log.dim('\nMonitoring stopped.');
      process.exit(0);
    });
  });

monitorCommand
  .command('triage <project>')
  .description('Run AI-powered auto-triage on current health failures')
  .action(async (project: string) => {
    const config = loadConfig();
    const obsConfig = loadObservabilityConfig(config.vault, project);

    if (!obsConfig) {
      log.error(`No observability config for project "${project}".`);
      return;
    }

    log.header(`Auto-Triage: ${project}`);

    const checks = await checkAllHealth(obsConfig.health_endpoints);
    const failed = checks.filter(c => !c.healthy);

    if (failed.length === 0) {
      log.success('All endpoints healthy. Nothing to triage.');
      return;
    }

    log.warn(`${failed.length} failing endpoints — running AI triage...`);

    // Get logs if available
    let logOutput: string | undefined;
    if (obsConfig.log_command) {
      try {
        const { execa } = await import('execa');
        const parts = obsConfig.log_command.split(' ');
        const logResult = await execa(parts[0], parts.slice(1), { timeout: 10_000 });
        logOutput = logResult.stdout;
      } catch {
        log.dim('Could not retrieve logs.');
      }
    }

    const taskPath = await autoTriage(project, checks, config, logOutput);

    if (taskPath) {
      log.success(`Triage task created: ${taskPath}`);
      log.dim('Run "oasis task dev <taskId>" to start investigating.');
    } else {
      log.dim('No triage task was created.');
    }
  });
