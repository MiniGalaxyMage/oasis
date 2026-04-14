import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'es2022',
  clean: true,
  dts: true,
  // Externalize ALL node_modules — don't bundle runtime dependencies.
  // This avoids CJS/ESM interop issues with transitive deps like
  // yoctocolors-cjs that use dynamic require(). Node resolves them
  // from node_modules at runtime.
  // Shebang is already present in src/index.ts — no banner needed.
  skipNodeModulesBundle: true,
});
