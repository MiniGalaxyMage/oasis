import { Command } from 'commander';
import { log } from '../utils/logger.js';
import { loadConfig } from '../core/config.js';
import { listProjects, listTasks } from '../core/vault.js';

export const briefingCommand = new Command('briefing')
  .description('Show a morning briefing of all tasks and projects')
  .action(async () => {
    const config = loadConfig();
    const projects = listProjects(config.vault);

    log.header('Oasis Morning Briefing');
    log.dim(new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }));

    if (projects.length === 0) {
      log.dim('No projects registered.');
      return;
    }

    const statusIcons: Record<string, string> = {
      'backlog': '⬜',
      'ready': '🟡',
      'in-progress': '🔵',
      'review': '🟣',
      'deploying': '🟠',
      'done': '🟢',
    };

    let totalInProgress = 0;
    let totalReady = 0;
    let totalBacklog = 0;

    for (const project of projects) {
      const allTasks = listTasks(config.vault, project);
      if (allTasks.length === 0) continue;

      const inProgress = allTasks.filter(t => t.status === 'in-progress');
      const ready = allTasks.filter(t => t.status === 'ready');
      const review = allTasks.filter(t => t.status === 'review');
      const backlog = allTasks.filter(t => t.status === 'backlog');

      totalInProgress += inProgress.length;
      totalReady += ready.length;
      totalBacklog += backlog.length;

      console.log(`\n  📁 ${project}`);

      if (inProgress.length > 0) {
        for (const t of inProgress) {
          console.log(`     ${statusIcons['in-progress']} ${t.id}: ${t.title} [IN PROGRESS]`);
        }
      }

      if (review.length > 0) {
        for (const t of review) {
          console.log(`     ${statusIcons['review']} ${t.id}: ${t.title} [REVIEW]`);
        }
      }

      if (ready.length > 0) {
        for (const t of ready) {
          const priorityLabel = t.priority === 'critical' ? ' ⚡' : '';
          console.log(`     ${statusIcons['ready']} ${t.id}: ${t.title} [READY]${priorityLabel}`);
        }
      }

      if (backlog.length > 0) {
        console.log(`     ${statusIcons['backlog']} ${backlog.length} tasks in backlog`);
      }
    }

    console.log('');
    log.header('Summary');
    log.info(`🔵 In progress: ${totalInProgress}`);
    log.info(`🟡 Ready to start: ${totalReady}`);
    log.info(`⬜ Backlog: ${totalBacklog}`);

    if (totalReady > 0 && totalInProgress === 0) {
      log.step('No active work — pick up a ready task!');
    }
  });
