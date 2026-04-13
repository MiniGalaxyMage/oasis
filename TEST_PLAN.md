# Oasis CLI — Test Plan

## Test Framework

**Vitest** — native ESM + TypeScript, zero config, fast, compatible con el stack.

## Test Layers

```
Layer 1: Unit Tests (pure logic, no mocks)          → ~20 tests
Layer 2: Unit Tests (mocked I/O)                    → ~35 tests
Layer 3: Integration Tests (real filesystem, temp dirs) → ~10 tests
Layer 4: E2E Tests (full CLI, subprocess)            → ~8 tests
```

---

## Layer 1: Unit Tests — Pure Logic (sin mocks)

Funciones que son lógica pura, sin I/O. Se testean directo.

### `src/utils/platform.test.ts`
| # | Test | Función | Qué valida |
|---|------|---------|-----------|
| 1 | getPlatform returns valid platform | `getPlatform()` | Retorna 'darwin', 'win32', o 'linux' |
| 2 | getOasisConfigDir uses APPDATA on win32 | `getOasisConfigDir()` | En Windows usa %APPDATA%/oasis |
| 3 | getOasisConfigDir uses ~/.oasis on unix | `getOasisConfigDir()` | En macOS/Linux usa ~/.oasis |
| 4 | getConfigPath ends with config.yaml | `getConfigPath()` | Path termina en config.yaml |
| 5 | expandHome replaces tilde | `expandHome('~/foo')` | Reemplaza ~ por homedir |
| 6 | expandHome ignores absolute paths | `expandHome('/abs/path')` | No modifica paths absolutos |

### `src/providers/index.test.ts`
| # | Test | Función | Qué valida |
|---|------|---------|-----------|
| 7 | getProviderAdapter returns claude adapter | `getProviderAdapter('claude')` | Retorna ClaudeAdapter |
| 8 | getProviderAdapter returns codex adapter | `getProviderAdapter('codex')` | Retorna CodexAdapter |
| 9 | getProviderAdapter throws on unknown | `getProviderAdapter('unknown')` | Throws con mensaje útil |
| 10 | listProviders returns all registered | `listProviders()` | Incluye 'claude' y 'codex' |

### `src/core/config.test.ts`
| # | Test | Función | Qué valida |
|---|------|---------|-----------|
| 11 | getProvider returns named provider | `getProvider(config, 'claude')` | Retorna ProviderConfig correcta |
| 12 | getProvider uses default when no name | `getProvider(config)` | Usa config.providers.default |
| 13 | getProvider throws on unknown | `getProvider(config, 'nope')` | Throws Error |

### `src/core/review-gate.test.ts`
| # | Test | Función | Qué valida |
|---|------|---------|-----------|
| 14 | getReviewGateConfig merges project over global | `getReviewGateConfig()` | Project config overrides global |
| 15 | getReviewGateConfig uses defaults when empty | `getReviewGateConfig({}, {})` | Defaults: auto reviews, 2 retries |
| 16 | getReviewGateConfig respects human phase | `getReviewGateConfig()` | design: 'human' se preserva |

### `src/core/dependencies.test.ts`
| # | Test | Función | Qué valida |
|---|------|---------|-----------|
| 17 | getAvailableProviders filters installed | `getAvailableProviders()` | Solo retorna providers con installed: true |
| 18 | getAvailableProviders returns empty if none | `getAvailableProviders([])` | Array vacío si no hay providers |

---

## Layer 2: Unit Tests — Mocked I/O

Funciones que tocan filesystem, execa, o inquirer. Se mockean las dependencias.

### `src/core/vault.test.ts` (mock: node:fs)
| # | Test | Qué valida |
|---|------|-----------|
| 19 | createVaultStructure creates all directories | Llama mkdirSync para cada dir de VAULT_DIRS |
| 20 | createVaultStructure writes schema.md | Crea _oasis/schema.md si no existe |
| 21 | createVaultStructure is idempotent | No sobreescribe archivos existentes |
| 22 | registerProject creates backlog/decisions/skills | Crea subdirectorios del proyecto |
| 23 | registerProject writes project.yaml | Genera config YAML por defecto |
| 24 | listProjects returns directory names | Lee projects/ y retorna nombres |
| 25 | listProjects returns empty if no projects dir | Retorna [] si no existe |
| 26 | listTasks parses frontmatter correctly | Parse YAML frontmatter de tasks .md |
| 27 | listTasks filters by status | Filtra por status cuando se pasa |
| 28 | listTasks skips malformed files | No crashea con .md malformados |
| 29 | getNextReadyTask returns highest priority | critical > high > medium > low |
| 30 | getNextReadyTask returns null if none ready | Retorna null sin tareas ready |
| 31 | hasInProgressTask detects active task | true si hay tarea in-progress |

### `src/core/config.test.ts` (mock: node:fs)
| # | Test | Qué valida |
|---|------|-----------|
| 32 | configExists returns true when file exists | existsSync check |
| 33 | configExists returns false when missing | existsSync check |
| 34 | loadConfig parses YAML correctly | Parse completo del config |
| 35 | loadConfig throws when not initialized | Error si no existe config |
| 36 | saveConfig creates directory if needed | mkdirSync recursive |
| 37 | saveConfig writes valid YAML | Output es YAML parseable |

### `src/utils/git.test.ts` (mock: execa)
| # | Test | Qué valida |
|---|------|-----------|
| 38 | isGitInstalled returns true when available | execa('git', ['--version']) ok |
| 39 | isGitInstalled returns false on error | execa throws → false |
| 40 | getGitVersion extracts semver | Parse "git version 2.44.0" |
| 41 | isGitRepo detects git directory | execa rev-parse ok → true |
| 42 | getCurrentBranch returns trimmed branch | Trim del stdout |
| 43 | createBranch calls git checkout -b | Verifica args correctos |

### `src/core/dependencies.test.ts` (mock: execa, inquirer)
| # | Test | Qué valida |
|---|------|-----------|
| 44 | checkDependency returns installed=true on success | execa ok → installed |
| 45 | checkDependency returns installed=false on error | execa throws → not installed |
| 46 | checkDependency extracts version | Parse semver del stdout |
| 47 | checkAllDependencies checks all deps | Recorre DEPENDENCIES array |
| 48 | installMissing exits on required missing | process.exit si falta git |
| 49 | installMissing asks to install optional | confirm dialog para opcionales |
| 50 | installMissing handles install failure gracefully | No crashea si npm install falla |

### `src/providers/claude.test.ts` (mock: execa)
| # | Test | Qué valida |
|---|------|-----------|
| 51 | isAvailable returns true when claude exists | execa ok → true |
| 52 | execute builds correct args | -p prompt, --allowedTools, --model |
| 53 | execute handles timeout/error | ExecaError → exitCode: 1 |
| 54 | review parses JSON response | Extrae JSON del stdout |
| 55 | review returns failed on unparseable | Fallback cuando no hay JSON |

### `src/providers/codex.test.ts` (mock: execa)
| # | Test | Qué valida |
|---|------|-----------|
| 56 | execute uses -q flag (not -p) | codex usa -q para prompt |
| 57 | execute does not pass --allowedTools | codex no soporta ese flag |

### `src/core/review-gate.test.ts` (mock: provider)
| # | Test | Qué valida |
|---|------|-----------|
| 58 | skip mode passes immediately | mode 'skip' → passed: true, attempts: 0 |
| 59 | human mode escalates immediately | mode 'human' → escalatedToHuman: true |
| 60 | auto mode passes on first try | provider.review passed → done |
| 61 | auto mode retries on failure | Reintenta hasta max_retries |
| 62 | auto mode escalates after all retries | Todos fallan → escalatedToHuman |
| 63 | correct criteria used per phase | proposal usa criteria de proposal |

### `src/core/context-gatherer.test.ts` (mock: fs, vault)
| # | Test | Qué valida |
|---|------|-----------|
| 64 | finds cross-project tasks by shared tags | Tag matching funciona |
| 65 | finds wiki pages by tag match | Filename matching funciona |
| 66 | handles empty tags gracefully | No crashea con tags: [] |
| 67 | builds markdown summary | summary tiene formato correcto |

### `src/core/scheduler.test.ts` (mock: execa, fs, vault, config)
| # | Test | Qué valida |
|---|------|-----------|
| 68 | pollProjects skips busy projects | in-progress → skip |
| 69 | pollProjects finds ready tasks | ready tasks detectadas |
| 70 | pollProjects handles no projects | Empty result |
| 71 | installScheduler dispatches by platform | darwin→launchd, win32→schtasks, linux→cron |

### `src/core/skill-generator.test.ts` (mock: fs, provider)
| # | Test | Qué valida |
|---|------|-----------|
| 72 | skips non-high complexity tasks | complexity !== 'high' → null |
| 73 | generates skill file on success | writeFileSync called |
| 74 | creates wiki pattern reference | wiki/patterns/ file created |
| 75 | handles unavailable provider | Provider not available → null |

---

## Layer 3: Integration Tests (filesystem real, temp dirs)

Tests que usan el filesystem real con directorios temporales. Validan flujos completos.

### `tests/integration/vault.integration.test.ts`
| # | Test | Qué valida |
|---|------|-----------|
| 76 | Full vault lifecycle | createVaultStructure → registerProject → listProjects → verificar archivos en disco |
| 77 | Task CRUD cycle | Crear task .md → listTasks → parse frontmatter → verificar datos |
| 78 | Task priority ordering | Varias tasks con prioridades → getNextReadyTask retorna la correcta |

### `tests/integration/config.integration.test.ts`
| # | Test | Qué valida |
|---|------|-----------|
| 79 | Config save and load roundtrip | saveConfig → loadConfig → datos idénticos |
| 80 | Config creates nested directories | saveConfig en path que no existe → mkdirSync recursive |

### `tests/integration/context.integration.test.ts`
| # | Test | Qué valida |
|---|------|-----------|
| 81 | Context gathering with real vault | Vault con tasks + wiki → gatherContext encuentra relaciones |

### `tests/integration/scheduler.integration.test.ts`
| # | Test | Qué valida |
|---|------|-----------|
| 82 | pollProjects with real vault structure | Vault con proyectos + tasks → polling detecta ready tasks |

---

## Layer 4: E2E Tests (CLI como subprocess)

Ejecutan `npx tsx src/index.ts <command>` como proceso externo. Validan que el CLI funciona end-to-end.

### `tests/e2e/cli.e2e.test.ts`
| # | Test | Qué valida |
|---|------|-----------|
| 83 | oasis --version prints version | Stdout contiene "0.1.0" |
| 84 | oasis --help shows all commands | Stdout lista init, task, scheduler, wiki, briefing, project |
| 85 | oasis task --help shows subcommands | Stdout lista new, list, context, dev, review, deploy, close |
| 86 | oasis init creates config + vault | En temp dir → genera ~/.oasis/config.yaml y vault structure |
| 87 | oasis task new → task list roundtrip | Crear task → listar → aparece con datos correctos |
| 88 | oasis project new registers project | Crear proyecto → aparece en project list |
| 89 | oasis scheduler status shows config | Muestra method + interval + active status |
| 90 | oasis briefing shows project summary | Con vault poblado → muestra resumen correcto |

---

## Test Matrix: Prioridad

| Prioridad | Layer | Tests | Razón |
|-----------|-------|-------|-------|
| P0 - Critical | L1 + L2 | vault, config, providers | Core data layer — si falla, nada funciona |
| P1 - High | L2 | review-gate, scheduler, dependencies | Automatización clave — errores aquí rompen el flujo |
| P2 - Medium | L3 | Integration tests | Valida que todo funciona junto con filesystem real |
| P3 - Low | L4 | E2E tests | Valida la experiencia del usuario final |

## Ejecución

```bash
# Todos los tests
npm test

# Solo unit tests
npm run test:unit

# Solo integration
npm run test:integration

# Solo e2e
npm run test:e2e

# Watch mode durante desarrollo
npm run test:watch

# Coverage
npm run test:coverage
```

## Estructura de archivos

```
oasis/
├── src/
│   ├── utils/
│   │   ├── platform.ts
│   │   ├── platform.test.ts        ← L1
│   │   ├── git.ts
│   │   ├── git.test.ts             ← L2
│   │   └── logger.ts
│   ├── core/
│   │   ├── vault.ts
│   │   ├── vault.test.ts           ← L1 + L2
│   │   ├── config.ts
│   │   ├── config.test.ts          ← L1 + L2
│   │   ├── dependencies.ts
│   │   ├── dependencies.test.ts    ← L1 + L2
│   │   ├── review-gate.ts
│   │   ├── review-gate.test.ts     ← L1 + L2
│   │   ├── context-gatherer.ts
│   │   ├── context-gatherer.test.ts ← L2
│   │   ├── scheduler.ts
│   │   ├── scheduler.test.ts       ← L2
│   │   └── skill-generator.ts
│   │   └── skill-generator.test.ts ← L2
│   └── providers/
│       ├── index.ts
│       ├── index.test.ts           ← L1
│       ├── claude.ts
│       ├── claude.test.ts          ← L2
│       ├── codex.ts
│       └── codex.test.ts           ← L2
├── tests/
│   ├── integration/
│   │   ├── vault.integration.test.ts
│   │   ├── config.integration.test.ts
│   │   ├── context.integration.test.ts
│   │   └── scheduler.integration.test.ts
│   └── e2e/
│       └── cli.e2e.test.ts
└── vitest.config.ts
```
