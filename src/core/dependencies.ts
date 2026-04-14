import { execa } from 'execa';
import { confirm } from '@inquirer/prompts';
import { log } from '../utils/logger.js';
import { listProviders, getProviderAdapter } from '../providers/index.js';

export interface Dependency {
  name: string;
  checkCommand: string[];
  versionFlag?: string[];
  required: boolean;
  installCommand?: string;
  installPrompt?: string;
  type: 'system' | 'mcp' | 'ai-provider';
}

export interface DependencyStatus {
  name: string;
  installed: boolean;
  version?: string;
  type: Dependency['type'];
}

const DEPENDENCIES: Dependency[] = [
  {
    name: 'git',
    checkCommand: ['git', '--version'],
    required: true,
    type: 'system',
  },
  {
    name: 'engram',
    checkCommand: ['npx', 'engram-mcp', '--version'],
    required: false,
    installCommand: 'npm install -g engram-mcp',
    installPrompt: 'Engram (persistent memory for AI agents)',
    type: 'mcp',
  },
  {
    name: 'context7',
    checkCommand: ['npx', '@upstash/context7-mcp', '--version'],
    required: false,
    installCommand: 'npm install -g @upstash/context7-mcp',
    installPrompt: 'Context7 (contextual documentation for AI)',
    type: 'mcp',
  },
  // AI providers are detected dynamically via their adapter's isAvailable()
  // method — see checkAIProviders() below. This keeps detection logic in
  // each adapter (e.g., MiniMax checks env var, Claude checks local binary).
];

export async function checkDependency(dep: Dependency): Promise<DependencyStatus> {
  try {
    const { stdout } = await execa(dep.checkCommand[0], dep.checkCommand.slice(1), {
      timeout: 10_000,
    });
    const version = stdout.match(/(\d+\.\d+[\.\d]*)/)?.[1] ?? 'found';
    return { name: dep.name, installed: true, version, type: dep.type };
  } catch {
    return { name: dep.name, installed: false, type: dep.type };
  }
}

export async function checkAIProviders(): Promise<DependencyStatus[]> {
  const results: DependencyStatus[] = [];

  for (const name of listProviders()) {
    const adapter = getProviderAdapter(name);
    let installed = false;
    let version: string | undefined;

    try {
      installed = await adapter.isAvailable();
      if (installed) {
        version = await adapter.getVersion();
      }
    } catch {
      installed = false;
    }

    results.push({
      name,
      installed,
      version,
      type: 'ai-provider',
    });
  }

  return results;
}

export async function checkAllDependencies(): Promise<DependencyStatus[]> {
  log.header('Checking dependencies');

  const results: DependencyStatus[] = [];

  // System and MCP dependencies (binary checks)
  for (const dep of DEPENDENCIES) {
    const status = await checkDependency(dep);

    if (status.installed) {
      log.success(`${dep.name} (${status.version})`);
    } else if (dep.required) {
      log.error(`${dep.name} — required but not found`);
    } else {
      log.warn(`${dep.name} — not found`);
    }

    results.push(status);
  }

  // AI providers (each adapter knows how to detect itself)
  const providerStatuses = await checkAIProviders();
  for (const status of providerStatuses) {
    if (status.installed) {
      log.success(`${status.name} (${status.version ?? 'available'})`);
    } else {
      log.warn(`${status.name} — not available (optional)`);
    }
    results.push(status);
  }

  return results;
}

export async function installMissing(statuses: DependencyStatus[]): Promise<void> {
  const missing = statuses.filter(s => !s.installed);

  // Check for required missing deps
  const requiredMissing = missing.filter(s => {
    const dep = DEPENDENCIES.find(d => d.name === s.name);
    return dep?.required;
  });

  if (requiredMissing.length > 0) {
    log.error(`Required dependencies missing: ${requiredMissing.map(d => d.name).join(', ')}`);
    log.step('Please install them manually before continuing.');
    process.exit(1);
  }

  // Offer to install optional deps that have install commands
  const installable = missing.filter(s => {
    const dep = DEPENDENCIES.find(d => d.name === s.name);
    return dep?.installCommand;
  });

  for (const status of installable) {
    const dep = DEPENDENCIES.find(d => d.name === status.name)!;

    const shouldInstall = await confirm({
      message: `Install ${dep.installPrompt ?? dep.name}?`,
      default: true,
    });

    if (shouldInstall && dep.installCommand) {
      log.step(`Installing ${dep.name}...`);
      try {
        const parts = dep.installCommand.split(' ');
        await execa(parts[0], parts.slice(1), { stdio: 'inherit' });
        log.success(`${dep.name} installed`);
      } catch (error: any) {
        log.error(`Failed to install ${dep.name}: ${error.message}`);
        log.dim('You can install it manually later.');
      }
    }
  }
}

export function getAvailableProviders(statuses: DependencyStatus[]): string[] {
  return statuses
    .filter(s => s.installed && s.type === 'ai-provider')
    .map(s => s.name);
}
