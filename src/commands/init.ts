import { Command } from 'commander';
import { input, select, confirm, checkbox } from '@inquirer/prompts';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { log } from '../utils/logger.js';
import { getPlatform, expandHome, getDefaultVaultPath } from '../utils/platform.js';
import { saveConfig, configExists, type OasisConfig, type SchedulerConfig } from '../core/config.js';
import { checkAllDependencies, installMissing, getAvailableProviders } from '../core/dependencies.js';
import { createVaultStructure, registerProject } from '../core/vault.js';

export const initCommand = new Command('init')
  .description('Initialize Oasis — interactive setup')
  .action(async () => {
    log.header('Oasis Setup');

    if (configExists()) {
      const overwrite = await confirm({
        message: 'Oasis is already configured. Reconfigure?',
        default: false,
      });
      if (!overwrite) {
        log.info('Setup cancelled.');
        return;
      }
    }

    // Phase 1: Dependencies
    const depStatuses = await checkAllDependencies();
    await installMissing(depStatuses);

    // Phase 2: Vault
    log.header('Vault Setup');

    const vaultAction = await select({
      message: 'Obsidian vault:',
      choices: [
        { value: 'existing', name: 'Use existing vault' },
        { value: 'new', name: 'Create new vault' },
      ],
    });

    let vaultPath: string;
    if (vaultAction === 'existing') {
      const rawPath = await input({
        message: 'Path to your Obsidian vault:',
        default: getDefaultVaultPath(),
        validate: (val) => {
          const expanded = expandHome(val);
          if (!existsSync(expanded)) return `Directory not found: ${expanded}`;
          return true;
        },
      });
      vaultPath = resolve(expandHome(rawPath));
    } else {
      const rawPath = await input({
        message: 'Path for the new vault:',
        default: getDefaultVaultPath(),
      });
      vaultPath = resolve(expandHome(rawPath));
    }

    log.step('Creating vault structure...');
    createVaultStructure(vaultPath);
    log.success('Vault structure ready');

    // Scan for existing projects to register
    const scanForProjects = await confirm({
      message: 'Scan for existing project directories to register?',
      default: true,
    });

    if (scanForProjects) {
      const scanPath = await input({
        message: 'Directory to scan for projects:',
        default: process.cwd(),
      });

      const expanded = expandHome(scanPath);
      if (existsSync(expanded)) {
        const dirs = readdirSync(expanded, { withFileTypes: true })
          .filter(d => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_'))
          .map(d => d.name);

        if (dirs.length > 0) {
          const selected = await checkbox({
            message: 'Select projects to register:',
            choices: dirs.map(d => ({ value: d, name: d })),
          });

          for (const projectName of selected) {
            registerProject(vaultPath, projectName);
            log.success(`Registered project: ${projectName}`);
          }
        } else {
          log.dim('No directories found to register.');
        }
      }
    }

    // Phase 3: Provider config
    log.header('Provider Configuration');

    const availableProviders = getAvailableProviders(depStatuses);

    let defaultProvider = 'claude';
    if (availableProviders.length > 0) {
      defaultProvider = await select({
        message: 'Default AI provider:',
        choices: availableProviders.map(p => ({ value: p, name: p })),
      });
    } else {
      log.warn('No AI providers detected. You can configure them later in ~/.oasis/config.yaml');
      const manualProvider = await input({
        message: 'Default provider name (will be configured later):',
        default: 'claude',
      });
      defaultProvider = manualProvider;
    }

    // Review config
    const defaultReviewModel = await input({
      message: 'Default review model:',
      default: 'opus',
    });

    const autoReview = await confirm({
      message: 'Enable auto-review between SDD phases?',
      default: true,
    });

    // Scheduler config
    const enableScheduler = await confirm({
      message: 'Enable task scheduler (periodic polling)?',
      default: true,
    });

    let schedulerConfig: SchedulerConfig;
    if (enableScheduler) {
      const intervalStr = await input({
        message: 'Polling interval (minutes):',
        default: '30',
        validate: (val) => {
          const n = parseInt(val, 10);
          if (isNaN(n) || n < 1) return 'Must be a positive number';
          return true;
        },
      });

      const platform = getPlatform();
      const method = platform === 'darwin' ? 'launchd' : platform === 'win32' ? 'schtasks' : 'cron';

      schedulerConfig = {
        enabled: true,
        interval_minutes: parseInt(intervalStr, 10),
        method,
      };
    } else {
      schedulerConfig = {
        enabled: false,
        interval_minutes: 30,
        method: getPlatform() === 'darwin' ? 'launchd' : getPlatform() === 'win32' ? 'schtasks' : 'cron',
      };
    }

    // Skills config
    const autoGenerateSkills = await confirm({
      message: 'Auto-generate skills from complex tasks?',
      default: true,
    });

    // Build config
    const platform = getPlatform();

    const providers: OasisConfig['providers'] = { default: defaultProvider };
    for (const status of depStatuses.filter(s => s.type === 'ai-provider')) {
      providers[status.name] = {
        command: status.name,
        available: status.installed,
      };
    }
    // Ensure the default provider entry exists even if not detected
    if (!providers[defaultProvider]) {
      providers[defaultProvider] = {
        command: defaultProvider,
        available: false,
      };
    }

    const config: OasisConfig = {
      vault: vaultPath,
      platform,
      providers,
      tools: {
        engram: {
          installed: depStatuses.find(s => s.name === 'engram')?.installed ?? false,
          type: 'mcp',
          package: 'engram-mcp',
        },
        context7: {
          installed: depStatuses.find(s => s.name === 'context7')?.installed ?? false,
          type: 'mcp',
          package: '@upstash/context7-mcp',
        },
      },
      review: {
        default_model: defaultReviewModel,
        auto_review: autoReview,
      },
      scheduler: schedulerConfig,
      skills: {
        common: ['typescript', 'react-19', 'pytest'],
        auto_generate: autoGenerateSkills,
      },
    };

    saveConfig(config);

    log.header('Setup Complete');
    log.success(`Vault: ${vaultPath}`);
    log.success(`Provider: ${defaultProvider}`);
    log.success(`Auto-review: ${autoReview ? 'enabled' : 'disabled'}`);
    log.success(`Scheduler: ${enableScheduler ? `every ${schedulerConfig.interval_minutes}min (${schedulerConfig.method})` : 'disabled'}`);
    log.success(`Skills auto-generation: ${autoGenerateSkills ? 'enabled' : 'disabled'}`);
    log.dim('\nRun "oasis task new" to create your first task.');
  });
