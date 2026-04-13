import { vi, beforeEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import YAML from 'yaml';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('../utils/platform.js', () => ({
  getConfigPath: () => '/tmp/test/.oasis/config.yaml',
  getOasisConfigDir: () => '/tmp/test/.oasis',
}));

// Import after mocks are set up
import { configExists, loadConfig, saveConfig, getProvider } from './config.js';
import type { OasisConfig } from './config.js';

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockMkdirSync = vi.mocked(mkdirSync);

function makeConfig(overrides?: Partial<OasisConfig>): OasisConfig {
  return {
    vault: '/home/user/oasis-vault',
    platform: 'darwin',
    providers: {
      default: 'claude',
      claude: { command: 'claude', available: true },
      codex: { command: 'codex', available: false },
    },
    tools: {},
    review: { default_model: 'claude', auto_review: false },
    scheduler: { enabled: false, interval_minutes: 30, method: 'launchd' },
    skills: { common: [], auto_generate: false },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Pure logic: getProvider ───────────────────────────────────────────────────

describe('getProvider (pure logic)', () => {
  it('returns the claude ProviderConfig when name is "claude"', () => {
    const config = makeConfig();
    const provider = getProvider(config, 'claude');
    expect(provider).toEqual({ command: 'claude', available: true });
  });

  it('uses the default provider when no name is given', () => {
    const config = makeConfig();
    const provider = getProvider(config);
    // default is 'claude'
    expect(provider).toEqual({ command: 'claude', available: true });
  });

  it('throws an Error for a nonexistent provider', () => {
    const config = makeConfig();
    expect(() => getProvider(config, 'nonexistent')).toThrow(Error);
    expect(() => getProvider(config, 'nonexistent')).toThrow("Provider 'nonexistent' not configured.");
  });
});

// ── Mocked fs: configExists ───────────────────────────────────────────────────

describe('configExists', () => {
  it('returns true when existsSync returns true', () => {
    mockExistsSync.mockReturnValueOnce(true);
    expect(configExists()).toBe(true);
  });

  it('returns false when existsSync returns false', () => {
    mockExistsSync.mockReturnValueOnce(false);
    expect(configExists()).toBe(false);
  });
});

// ── Mocked fs: loadConfig ─────────────────────────────────────────────────────

describe('loadConfig', () => {
  it('parses YAML correctly when file exists', () => {
    const config = makeConfig();
    const yaml = YAML.stringify(config);

    mockExistsSync.mockReturnValueOnce(true);
    mockReadFileSync.mockReturnValueOnce(yaml as any);

    const result = loadConfig();
    expect(result.vault).toBe(config.vault);
    expect(result.providers.default).toBe('claude');
  });

  it('throws when the config file does not exist', () => {
    mockExistsSync.mockReturnValueOnce(false);
    expect(() => loadConfig()).toThrow(/oasis init/i);
  });
});

// ── Mocked fs: saveConfig ─────────────────────────────────────────────────────

describe('saveConfig', () => {
  it('creates the parent directory with recursive: true when it does not exist', () => {
    mockExistsSync.mockReturnValueOnce(false); // dir check
    const config = makeConfig();

    saveConfig(config);

    expect(mockMkdirSync).toHaveBeenCalledWith('/tmp/test/.oasis', { recursive: true });
  });

  it('does NOT call mkdirSync when the parent directory already exists', () => {
    mockExistsSync.mockReturnValueOnce(true); // dir already there
    const config = makeConfig();

    saveConfig(config);

    expect(mockMkdirSync).not.toHaveBeenCalled();
  });

  it('writes valid parseable YAML to the config path', () => {
    mockExistsSync.mockReturnValueOnce(true);
    const config = makeConfig();

    saveConfig(config);

    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const [writtenPath, writtenContent] = mockWriteFileSync.mock.calls[0] as [string, string, string];
    expect(writtenPath).toBe('/tmp/test/.oasis/config.yaml');

    // Must be valid YAML
    const parsed = YAML.parse(writtenContent) as OasisConfig;
    expect(parsed.vault).toBe(config.vault);
    expect(parsed.providers.default).toBe('claude');
  });
});
