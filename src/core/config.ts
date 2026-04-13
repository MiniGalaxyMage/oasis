import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import YAML from 'yaml';
import { getConfigPath, getOasisConfigDir } from '../utils/platform.js';

export interface ProviderConfig {
  command: string;
  available: boolean;
  flags?: string[];
}

export interface ToolConfig {
  installed: boolean;
  type: 'mcp' | 'cli';
  package?: string;
}

export interface SchedulerConfig {
  enabled: boolean;
  interval_minutes: number;
  method: 'launchd' | 'schtasks' | 'cron';
}

export interface ReviewConfig {
  default_model: string;
  auto_review: boolean;
}

export interface SkillsConfig {
  common: string[];
  auto_generate: boolean;
}

export interface OasisConfig {
  vault: string;
  platform: string;
  providers: {
    default: string;
    [key: string]: ProviderConfig | string;
  };
  tools: Record<string, ToolConfig>;
  review: ReviewConfig;
  scheduler: SchedulerConfig;
  skills: SkillsConfig;
}

export function configExists(): boolean {
  return existsSync(getConfigPath());
}

export function loadConfig(): OasisConfig {
  const path = getConfigPath();
  if (!existsSync(path)) {
    throw new Error(`Oasis not initialized. Run 'oasis init' first.`);
  }
  const raw = readFileSync(path, 'utf-8');
  return YAML.parse(raw) as OasisConfig;
}

export function saveConfig(config: OasisConfig): void {
  const path = getConfigPath();
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, YAML.stringify(config, { indent: 2 }), 'utf-8');
}

export function getProvider(config: OasisConfig, name?: string): ProviderConfig {
  const providerName = name || config.providers.default;
  const provider = config.providers[providerName];
  if (!provider || typeof provider === 'string') {
    throw new Error(`Provider '${providerName}' not configured.`);
  }
  return provider;
}
