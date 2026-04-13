import { Command } from 'commander';
import { input, select, checkbox } from '@inquirer/prompts';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { log } from '../utils/logger.js';
import { loadConfig } from '../core/config.js';
import { listProjects, listTasks, type TaskFrontmatter } from '../core/vault.js';
import { getProviderAdapter } from '../providers/index.js';
import { createBranch, isGitRepo } from '../utils/git.js';

const taskCommand = new Command('task')
  .description('Manage tasks in the Oasis vault');

// --- task new ---
taskCommand
  .command('new')
  .description('Create a new task in the vault')
  .action(async () => {
    const config = loadConfig();
    const projects = listProjects(config.vault);

    if (projects.length === 0) {
      log.error('No projects registered. Run "oasis init" to register projects.');
      return;
    }

    const project = await select({
      message: 'Project:',
      choices: projects.map(p => ({ value: p, name: p })),
    });

    const id = await input({
      message: 'Task ID (e.g., HON-001):',
      validate: (val) => val.trim().length > 0 || 'ID is required',
    });

    const title = await input({
      message: 'Title:',
      validate: (val) => val.trim().length > 0 || 'Title is required',
    });

    const priority = await select({
      message: 'Priority:',
      choices: [
        { value: 'critical', name: 'Critical' },
        { value: 'high', name: 'High' },
        { value: 'medium', name: 'Medium' },
        { value: 'low', name: 'Low' },
      ],
      default: 'medium',
    });

    const complexity = await select({
      message: 'Complexity:',
      choices: [
        { value: 'low', name: 'Low' },
        { value: 'medium', name: 'Medium' },
        { value: 'high', name: 'High (triggers skill generation)' },
      ],
      default: 'medium',
    });

    const tagsStr = await input({
      message: 'Tags (comma-separated):',
      default: '',
    });
    const tags = tagsStr.split(',').map(t => t.trim()).filter(Boolean);

    const now = new Date().toISOString().split('T')[0];
    const frontmatter: TaskFrontmatter = {
      id: id.trim(),
      title: title.trim(),
      status: 'backlog',
      project,
      priority: priority as TaskFrontmatter['priority'],
      created: now,
      tags,
      complexity: complexity as TaskFrontmatter['complexity'],
      branch: '',
    };

    const content = matter.stringify(
      '\n## Description\n\n\n## Acceptance Criteria\n- [ ] \n\n## Context Notes\n\n## SDD Artifacts\n\n## Review Notes\n\n## Deploy Log\n',
      frontmatter,
    );

    const filePath = join(config.vault, 'projects', project, 'backlog', `${id.trim()}.md`);
    writeFileSync(filePath, content, 'utf-8');

    log.success(`Task created: ${filePath}`);
    log.dim('Edit the task in Obsidian to add description and acceptance criteria.');
    log.dim('When ready, run "oasis task context ' + id.trim() + '" to gather context.');
  });

// --- task list ---
taskCommand
  .command('list [project]')
  .description('List tasks')
  .option('-s, --status <status>', 'Filter by status')
  .action(async (project?: string, opts?: { status?: string }) => {
    const config = loadConfig();
    const projects = project ? [project] : listProjects(config.vault);

    if (projects.length === 0) {
      log.info('No projects registered.');
      return;
    }

    for (const proj of projects) {
      const tasks = listTasks(config.vault, proj, opts?.status);
      if (tasks.length === 0) {
        log.dim(`${proj}: no tasks${opts?.status ? ` with status "${opts.status}"` : ''}`);
        continue;
      }

      log.header(proj);
      const statusIcons: Record<string, string> = {
        'backlog': '⬜',
        'ready': '🟡',
        'in-progress': '🔵',
        'review': '🟣',
        'deploying': '🟠',
        'done': '🟢',
      };

      for (const task of tasks) {
        const icon = statusIcons[task.status] ?? '⬜';
        const priorityLabel = task.priority === 'critical' ? ' [CRITICAL]' :
                              task.priority === 'high' ? ' [HIGH]' : '';
        console.log(`  ${icon} ${task.id.padEnd(12)} ${task.title}${priorityLabel}  (${task.status})`);
      }
    }
  });

// --- task context ---
taskCommand
  .command('context <taskId>')
  .description('Gather context for a task from cross-project sources, wiki, and memory')
  .action(async (taskId: string) => {
    const config = loadConfig();
    const projects = listProjects(config.vault);

    // Find the task across projects
    let taskFile: string | null = null;
    let taskData: TaskFrontmatter | null = null;
    let taskContent: string = '';

    for (const proj of projects) {
      const filePath = join(config.vault, 'projects', proj, 'backlog', `${taskId}.md`);
      if (existsSync(filePath)) {
        const raw = readFileSync(filePath, 'utf-8');
        const parsed = matter(raw);
        taskData = parsed.data as TaskFrontmatter;
        taskContent = parsed.content;
        taskFile = filePath;
        break;
      }
    }

    if (!taskFile || !taskData) {
      log.error(`Task ${taskId} not found in any project.`);
      return;
    }

    log.header(`Gathering context for ${taskId}: ${taskData.title}`);

    const contextParts: string[] = [];

    // Cross-project: find related tasks by tags
    if (taskData.tags.length > 0) {
      log.step('Searching cross-project for related tasks...');
      for (const proj of projects) {
        const tasks = listTasks(config.vault, proj);
        for (const t of tasks) {
          if (t.id === taskId) continue;
          const sharedTags = t.tags.filter(tag => taskData!.tags.includes(tag));
          if (sharedTags.length > 0) {
            contextParts.push(`- **${t.id}** (${proj}): ${t.title} [${t.status}] — shared tags: ${sharedTags.join(', ')}`);
          }
        }
      }
    }

    // Wiki: search for relevant pages by tags
    log.step('Searching wiki...');
    const wikiDir = join(config.vault, 'wiki');
    if (existsSync(wikiDir)) {
      const wikiDirs = ['concepts', 'patterns', 'entities', 'summaries'];
      for (const subdir of wikiDirs) {
        const dir = join(wikiDir, subdir);
        if (!existsSync(dir)) continue;
        const files = readdirSync(dir).filter(f => f.endsWith('.md'));
        for (const file of files) {
          const name = file.replace('.md', '').toLowerCase();
          const matchesTag = taskData.tags.some(tag => name.includes(tag.toLowerCase()));
          if (matchesTag) {
            contextParts.push(`- **Wiki**: ${subdir}/${file}`);
          }
        }
      }
    }

    // Update task with context
    let updatedContent = taskContent;
    if (contextParts.length > 0) {
      const contextSection = `\n### Auto-gathered context (${new Date().toISOString().split('T')[0]})\n${contextParts.join('\n')}\n`;
      updatedContent = taskContent.replace(
        '## Context Notes',
        `## Context Notes\n${contextSection}`,
      );
      log.success(`Found ${contextParts.length} related items`);
    } else {
      log.dim('No cross-project context found.');
    }

    // Update status to ready
    taskData.status = 'ready';
    const updated = matter.stringify(updatedContent, taskData);
    writeFileSync(taskFile, updated, 'utf-8');

    log.success(`Task ${taskId} status → ready`);
    log.dim(`Run "oasis task dev ${taskId}" to start development.`);
  });

// --- task dev ---
taskCommand
  .command('dev <taskId>')
  .description('Start development on a task using SDD')
  .option('-d, --dir <dir>', 'Project working directory')
  .action(async (taskId: string, opts?: { dir?: string }) => {
    const config = loadConfig();
    const projects = listProjects(config.vault);

    // Find the task
    let taskFile: string | null = null;
    let taskData: TaskFrontmatter | null = null;
    let taskContent: string = '';

    for (const proj of projects) {
      const filePath = join(config.vault, 'projects', proj, 'backlog', `${taskId}.md`);
      if (existsSync(filePath)) {
        const raw = readFileSync(filePath, 'utf-8');
        const parsed = matter(raw);
        taskData = parsed.data as TaskFrontmatter;
        taskContent = parsed.content;
        taskFile = filePath;
        break;
      }
    }

    if (!taskFile || !taskData) {
      log.error(`Task ${taskId} not found.`);
      return;
    }

    if (taskData.status !== 'ready' && taskData.status !== 'backlog') {
      log.warn(`Task ${taskId} has status "${taskData.status}". Expected "ready" or "backlog".`);
      log.dim('Run "oasis task context ' + taskId + '" first to gather context.');
      return;
    }

    // Get working directory
    let workDir = opts?.dir;
    if (!workDir) {
      workDir = await input({
        message: `Working directory for project "${taskData.project}":`,
        default: process.cwd(),
        validate: (val) => existsSync(val) || `Directory not found: ${val}`,
      });
    }

    // Create branch
    const slug = taskData.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    const branchName = `feat/${taskData.id}-${slug}`;

    if (await isGitRepo(workDir)) {
      log.step(`Creating branch: ${branchName}`);
      try {
        await createBranch(workDir, branchName);
        taskData.branch = branchName;
        log.success(`Branch created: ${branchName}`);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        log.warn(`Could not create branch: ${msg}`);
        log.dim('Continuing without branch creation.');
      }
    } else {
      log.warn(`${workDir} is not a git repository. Skipping branch creation.`);
    }

    // Build SDD prompt
    const sddPrompt = `You are starting development on a task using the SDD workflow.

## Task: ${taskData.id} — ${taskData.title}

**Project**: ${taskData.project}
**Priority**: ${taskData.priority}
**Complexity**: ${taskData.complexity}
**Tags**: ${taskData.tags.join(', ')}

${taskContent}

## Instructions

Use the SDD workflow to implement this task:
1. Start with /sdd-new ${taskData.id}-${slug}
2. Follow the full SDD pipeline: explore → propose → spec → design → tasks → apply → verify
3. Each phase will be auto-reviewed before advancing
4. When complete, ensure all changes are committed to the branch: ${branchName}

Focus on quality. Follow existing patterns in the codebase.`;

    // Update task status
    taskData.status = 'in-progress';
    const updated = matter.stringify(taskContent, taskData);
    writeFileSync(taskFile, updated, 'utf-8');

    log.success(`Task ${taskId} status → in-progress`);
    log.header('Starting SDD');

    // Get provider
    const providerName = taskData.provider || config.providers.default;
    const provider = getProviderAdapter(providerName as string);

    const isProviderAvailable = await provider.isAvailable();
    if (!isProviderAvailable) {
      log.error(`Provider "${providerName}" is not available.`);
      log.dim('The SDD prompt has been prepared. You can run it manually:');
      console.log('\n' + sddPrompt);
      return;
    }

    log.step(`Invoking ${providerName}...`);
    const result = await provider.execute({
      prompt: sddPrompt,
      workingDir: workDir,
      model: taskData.review_model,
    });

    if (result.exitCode === 0) {
      log.success('SDD session completed');
      log.dim(`Run "oasis task review ${taskId}" to review the changes.`);
    } else {
      log.error('SDD session ended with errors');
      log.dim(result.stderr);
    }
  });

// --- task review ---
taskCommand
  .command('review <taskId>')
  .description('Review changes from a completed development phase')
  .action(async (taskId: string) => {
    const config = loadConfig();
    const projects = listProjects(config.vault);

    let taskFile: string | null = null;
    let taskData: TaskFrontmatter | null = null;
    let taskContent: string = '';

    for (const proj of projects) {
      const filePath = join(config.vault, 'projects', proj, 'backlog', `${taskId}.md`);
      if (existsSync(filePath)) {
        const raw = readFileSync(filePath, 'utf-8');
        const parsed = matter(raw);
        taskData = parsed.data as TaskFrontmatter;
        taskContent = parsed.content;
        taskFile = filePath;
        break;
      }
    }

    if (!taskFile || !taskData) {
      log.error(`Task ${taskId} not found.`);
      return;
    }

    log.header(`Review: ${taskId} — ${taskData.title}`);
    log.info(`Branch: ${taskData.branch || 'none'}`);
    log.info(`Status: ${taskData.status}`);

    if (taskData.branch) {
      log.step('Review the branch changes and update task status:');
      log.dim(`  oasis task deploy ${taskId}  — to proceed with deploy`);
      log.dim(`  Edit the task in Obsidian to add review notes`);
    }

    taskData.status = 'review';
    const updated = matter.stringify(taskContent, taskData);
    writeFileSync(taskFile, updated, 'utf-8');
    log.success(`Task ${taskId} status → review`);
  });

// --- task deploy ---
taskCommand
  .command('deploy <taskId>')
  .description('Deploy a reviewed task')
  .option('-e, --env <environment>', 'Target environment', 'staging')
  .action(async (taskId: string, opts: { env: string }) => {
    const config = loadConfig();
    const projects = listProjects(config.vault);

    let taskFile: string | null = null;
    let taskData: TaskFrontmatter | null = null;
    let taskContent: string = '';

    for (const proj of projects) {
      const filePath = join(config.vault, 'projects', proj, 'backlog', `${taskId}.md`);
      if (existsSync(filePath)) {
        const raw = readFileSync(filePath, 'utf-8');
        const parsed = matter(raw);
        taskData = parsed.data as TaskFrontmatter;
        taskContent = parsed.content;
        taskFile = filePath;
        break;
      }
    }

    if (!taskFile || !taskData) {
      log.error(`Task ${taskId} not found.`);
      return;
    }

    // Read project deploy config
    const projectYamlPath = join(config.vault, 'projects', taskData.project, 'project.yaml');
    if (!existsSync(projectYamlPath)) {
      log.error(`No project.yaml found for ${taskData.project}. Create deploy config first.`);
      return;
    }

    const YAML = await import('yaml');
    const projectConfig = YAML.parse(readFileSync(projectYamlPath, 'utf-8'));
    const deployConfig = projectConfig?.deploy?.environments?.[opts.env];

    if (!deployConfig) {
      log.error(`No deploy config for environment "${opts.env}" in ${taskData.project}/project.yaml`);
      log.dim(`Available environments: ${Object.keys(projectConfig?.deploy?.environments ?? {}).join(', ') || 'none'}`);
      return;
    }

    log.header(`Deploying ${taskId} to ${opts.env}`);
    taskData.status = 'deploying';
    const deploying = matter.stringify(taskContent, taskData);
    writeFileSync(taskFile, deploying, 'utf-8');

    const { execa } = await import('execa');
    const deployEnv = opts.env;

    // Pre-deploy checks
    if (deployConfig.pre_deploy?.length > 0) {
      log.step('Running pre-deploy checks...');
      for (const cmd of deployConfig.pre_deploy) {
        log.dim(`  $ ${cmd}`);
        try {
          const parts = cmd.split(' ');
          await execa(parts[0], parts.slice(1), { stdio: 'inherit' });
          log.success(`  ${cmd}`);
        } catch (error: any) {
          log.error(`Pre-deploy check failed: ${cmd}`);
          taskData.status = 'review';
          const reverted = matter.stringify(taskContent, taskData);
          writeFileSync(taskFile, reverted, 'utf-8');
          return;
        }
      }
    }

    // Deploy
    log.step(`Deploying: ${deployConfig.command}`);
    try {
      const parts = deployConfig.command.split(' ');
      await execa(parts[0], parts.slice(1), { stdio: 'inherit' });
      log.success('Deploy completed');
    } catch (error: any) {
      log.error(`Deploy failed: ${error.message}`);
      taskData.status = 'review';
      const reverted = matter.stringify(taskContent, taskData);
      writeFileSync(taskFile, reverted, 'utf-8');
      return;
    }

    // Post-deploy verification
    if (deployConfig.post_deploy?.length > 0) {
      log.step('Running post-deploy verification...');
      for (const cmd of deployConfig.post_deploy) {
        log.dim(`  $ ${cmd}`);
        try {
          const parts = cmd.split(' ');
          await execa(parts[0], parts.slice(1), { stdio: 'inherit' });
          log.success(`  ${cmd}`);
        } catch (error: any) {
          log.warn(`Post-deploy check failed: ${cmd}`);
        }
      }
    }

    // Append deploy log to task
    const deployLog = `\n### Deploy to ${deployEnv} (${new Date().toISOString()})\n- Status: success\n- Command: ${deployConfig.command}\n`;
    const updatedContent = taskContent.replace('## Deploy Log', `## Deploy Log\n${deployLog}`);

    taskData.status = 'deploying'; // stays deploying until close
    const final = matter.stringify(updatedContent, taskData);
    writeFileSync(taskFile, final, 'utf-8');

    log.success(`Deploy to ${opts.env} complete`);
    log.dim(`Run "oasis task close ${taskId}" to finalize.`);
  });

// --- task close ---
taskCommand
  .command('close <taskId>')
  .description('Close a task — update Obsidian, generate skill if complex')
  .action(async (taskId: string) => {
    const config = loadConfig();
    const projects = listProjects(config.vault);

    let taskFile: string | null = null;
    let taskData: TaskFrontmatter | null = null;
    let taskContent: string = '';

    for (const proj of projects) {
      const filePath = join(config.vault, 'projects', proj, 'backlog', `${taskId}.md`);
      if (existsSync(filePath)) {
        const raw = readFileSync(filePath, 'utf-8');
        const parsed = matter(raw);
        taskData = parsed.data as TaskFrontmatter;
        taskContent = parsed.content;
        taskFile = filePath;
        break;
      }
    }

    if (!taskFile || !taskData) {
      log.error(`Task ${taskId} not found.`);
      return;
    }

    log.header(`Closing task: ${taskId}`);

    // Generate skill if complex
    if (taskData.complexity === 'high' && config.skills.auto_generate) {
      const { generateSkill } = await import('../core/skill-generator.js');
      await generateSkill(taskData, taskContent, config);
    }

    // Update status
    taskData.status = 'done';
    const updated = matter.stringify(taskContent, taskData);
    writeFileSync(taskFile, updated, 'utf-8');

    // Append to vault log
    const logPath = join(config.vault, 'log.md');
    if (existsSync(logPath)) {
      const logContent = readFileSync(logPath, 'utf-8');
      const entry = `\n## [${new Date().toISOString().split('T')[0]}] close | ${taskData.project}/${taskId}\n- **${taskData.title}**\n- Complexity: ${taskData.complexity}\n- Branch: ${taskData.branch}\n`;
      writeFileSync(logPath, logContent + entry, 'utf-8');
    }

    log.success(`Task ${taskId} status → done`);
    log.success('Task closed and logged.');
  });

export { taskCommand };

