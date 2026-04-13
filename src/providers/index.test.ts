import { getProviderAdapter, listProviders } from './index.js';

describe('getProviderAdapter', () => {
  it('returns an instance with name "claude" for "claude"', () => {
    const adapter = getProviderAdapter('claude');
    expect(adapter.name).toBe('claude');
  });

  it('returns an instance with name "codex" for "codex"', () => {
    const adapter = getProviderAdapter('codex');
    expect(adapter.name).toBe('codex');
  });

  it('throws an Error containing "Unknown provider" for unknown names', () => {
    expect(() => getProviderAdapter('unknown')).toThrow(/Unknown provider/);
  });

  it('error message from unknown provider includes the provider name', () => {
    expect(() => getProviderAdapter('unknown')).toThrow("Unknown provider: 'unknown'");
  });
});

describe('listProviders', () => {
  it('returns an array', () => {
    expect(Array.isArray(listProviders())).toBe(true);
  });

  it('contains "claude"', () => {
    expect(listProviders()).toContain('claude');
  });

  it('contains "codex"', () => {
    expect(listProviders()).toContain('codex');
  });
});
