import type { ProviderAdapter } from './adapter.js';
import { ClaudeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';
import { MinimaxAdapter } from './minimax.js';

const registry: Record<string, () => ProviderAdapter> = {
  claude: () => new ClaudeAdapter(),
  codex: () => new CodexAdapter(),
  minimax: () => new MinimaxAdapter(),
};

export function getProviderAdapter(name: string): ProviderAdapter {
  const factory = registry[name];
  if (!factory) {
    throw new Error(`Unknown provider: '${name}'. Available: ${Object.keys(registry).join(', ')}`);
  }
  return factory();
}

export function listProviders(): string[] {
  return Object.keys(registry);
}

export { type ProviderAdapter } from './adapter.js';
export { ClaudeAdapter } from './claude.js';
export { CodexAdapter } from './codex.js';
export { MinimaxAdapter } from './minimax.js';
