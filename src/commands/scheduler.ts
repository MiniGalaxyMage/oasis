import { Command } from 'commander';
import { log } from '../utils/logger.js';
import { loadConfig } from '../core/config.js';
import { installScheduler, removeScheduler, isSchedulerActive, pollProjects } from '../core/scheduler.js';

export const schedulerCommand = new Command('scheduler')
  .description('Manage the task polling scheduler');

schedulerCommand
  .command('start')
  .description('Install and start the scheduler (no admin required)')
  .action(async () => {
    const config = loadConfig();

    if (!config.scheduler.enabled) {
      log.warn('Scheduler is disabled in config. Enable it with "oasis init" or edit ~/.oasis/config.yaml');
      return;
    }

    const active = await isSchedulerActive();
    if (active) {
      log.info('Scheduler is already running.');
      return;
    }

    log.step(`Installing scheduler (${config.scheduler.method}, every ${config.scheduler.interval_minutes} min)...`);
    try {
      await installScheduler(config.scheduler.interval_minutes);
      log.success('Scheduler started');
    } catch (error: any) {
      log.error(`Failed to start scheduler: ${error.message}`);
    }
  });

schedulerCommand
  .command('stop')
  .description('Stop and uninstall the scheduler')
  .action(async () => {
    log.step('Removing scheduler...');
    try {
      await removeScheduler();
    } catch (error: any) {
      log.error(`Failed to stop scheduler: ${error.message}`);
    }
  });

schedulerCommand
  .command('status')
  .description('Show scheduler status')
  .action(async () => {
    const config = loadConfig();
    const active = await isSchedulerActive();

    log.header('Scheduler Status');
    log.info(`Enabled in config: ${config.scheduler.enabled ? 'yes' : 'no'}`);
    log.info(`Method: ${config.scheduler.method}`);
    log.info(`Interval: ${config.scheduler.interval_minutes} minutes`);
    log.info(`Active: ${active ? 'yes' : 'no'}`);
  });

schedulerCommand
  .command('run')
  .description('Run a single poll cycle (this is what the cron invokes)')
  .action(async () => {
    const result = pollProjects();

    if (result.readyTasks.length === 0) {
      if (result.busyProjects.length > 0) {
        log.dim(`All active projects busy: ${result.busyProjects.join(', ')}`);
      } else {
        log.dim('No ready tasks found.');
      }
      return;
    }

    log.header('Ready Tasks Found');
    for (const { project, task } of result.readyTasks) {
      log.info(`[${project}] ${task.id}: ${task.title} (${task.priority})`);
    }

    // Show highest priority task
    const top = result.readyTasks[0];
    log.step(`Highest priority: ${top.task.id} in ${top.project}`);
    log.dim(`Run "oasis task dev ${top.task.id}" to start.`);

    // TODO: OS notification (future enhancement)
    // For now, just terminal output
  });
