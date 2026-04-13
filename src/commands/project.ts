import { Command } from 'commander';
import { log } from '../utils/logger.js';
import { loadConfig } from '../core/config.js';
import { registerProject, listProjects, listTasks } from '../core/vault.js';

export const projectCommand = new Command('project')
  .description('Manage projects in the vault');

projectCommand
  .command('new <name>')
  .description('Register a new project in the vault with standard structure')
  .action(async (name: string) => {
    const config = loadConfig();

    log.step(`Registering project: ${name}`);
    registerProject(config.vault, name);

    // Install common skills
    if (config.skills.common.length > 0) {
      log.step(`Common skills available: ${config.skills.common.join(', ')}`);
      log.dim('Skills will be loaded automatically when working on this project.');
    }

    log.success(`Project "${name}" registered in vault`);
    log.dim(`  Backlog: projects/${name}/backlog/`);
    log.dim(`  Decisions: projects/${name}/decisions/`);
    log.dim(`  Skills: projects/${name}/skills/`);
    log.dim(`  Config: projects/${name}/project.yaml`);
    log.dim(`\nEdit project.yaml to configure deploy environments and review settings.`);
  });

projectCommand
  .command('list')
  .description('List all registered projects')
  .action(async () => {
    const config = loadConfig();
    const projects = listProjects(config.vault);

    if (projects.length === 0) {
      log.dim('No projects registered. Run "oasis project new <name>" or "oasis init".');
      return;
    }

    log.header('Registered Projects');
    for (const project of projects) {
      const tasks = listTasks(config.vault, project);
      const inProgress = tasks.filter(t => t.status === 'in-progress').length;
      const ready = tasks.filter(t => t.status === 'ready').length;
      const total = tasks.length;

      console.log(`  📁 ${project}  (${total} tasks: ${inProgress} active, ${ready} ready)`);
    }
  });
