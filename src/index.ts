#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { taskCommand } from './commands/task.js';
import { schedulerCommand } from './commands/scheduler.js';
import { wikiCommand } from './commands/wiki.js';
import { briefingCommand } from './commands/briefing.js';
import { projectCommand } from './commands/project.js';
import { monitorCommand } from './commands/monitor.js';

const program = new Command();

program
  .name('oasis')
  .description('Provider-agnostic AI dev orchestrator — from task intake to deploy')
  .version('0.1.0');

program.addCommand(initCommand);
program.addCommand(taskCommand);
program.addCommand(schedulerCommand);
program.addCommand(wikiCommand);
program.addCommand(briefingCommand);
program.addCommand(projectCommand);
program.addCommand(monitorCommand);

program.parse();
