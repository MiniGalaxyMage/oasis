import { Command } from 'commander';
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../utils/logger.js';
import { loadConfig } from '../core/config.js';
import { getProviderAdapter } from '../providers/index.js';

export const wikiCommand = new Command('wiki')
  .description('Manage the vault wiki (LLM Wiki pattern)');

// --- wiki ingest ---
wikiCommand
  .command('ingest')
  .description('Process new raw sources and update wiki pages')
  .action(async () => {
    const config = loadConfig();
    const rawDir = join(config.vault, 'raw-sources');

    if (!existsSync(rawDir)) {
      log.error('No raw-sources/ directory in vault.');
      return;
    }

    const files = readdirSync(rawDir).filter(f => f.endsWith('.md'));
    if (files.length === 0) {
      log.dim('No markdown files in raw-sources/');
      return;
    }

    log.header(`Ingesting ${files.length} source(s)`);

    const providerName = config.providers.default as string;
    const provider = getProviderAdapter(providerName);

    if (!(await provider.isAvailable())) {
      log.error(`Provider "${providerName}" not available.`);
      return;
    }

    const logPath = join(config.vault, 'log.md');

    for (const file of files) {
      log.step(`Processing: ${file}`);

      const prompt = `You are a wiki maintainer for an Obsidian vault. A new source has been added to raw-sources/.

Read the file at raw-sources/${file} and do the following:
1. Write a summary page to wiki/summaries/${file} with key takeaways
2. Identify concepts mentioned — for each, check if wiki/concepts/{concept}.md exists:
   - If yes, update it with new information from this source
   - If no, create it with information from this source
3. Identify patterns mentioned — for each, check if wiki/patterns/{pattern}.md exists:
   - If yes, update it
   - If no, create it
4. Update _oasis/index.md with links to all new/updated pages

Be thorough. Cross-reference between pages using [[wikilinks]].
Report every file you created or updated.`;

      const result = await provider.execute({
        prompt,
        workingDir: config.vault,
        allowedTools: ['Read', 'Write', 'Edit', 'Glob'],
      });

      if (result.exitCode === 0) {
        log.success(`Ingested: ${file}`);

        // Append to log
        if (existsSync(logPath)) {
          const logContent = readFileSync(logPath, 'utf-8');
          const entry = `\n## [${new Date().toISOString().split('T')[0]}] ingest | ${file}\n`;
          writeFileSync(logPath, logContent + entry, 'utf-8');
        }
      } else {
        log.error(`Failed to ingest: ${file}`);
        log.dim(result.stderr);
      }
    }
  });

// --- wiki query ---
wikiCommand
  .command('query <question>')
  .description('Ask a question against the wiki')
  .action(async (question: string) => {
    const config = loadConfig();
    const providerName = config.providers.default as string;
    const provider = getProviderAdapter(providerName);

    if (!(await provider.isAvailable())) {
      log.error(`Provider "${providerName}" not available.`);
      return;
    }

    log.step('Searching wiki...');

    const prompt = `You are a knowledge assistant with access to an Obsidian vault wiki.

First, read _oasis/index.md to understand what pages exist.
Then search for relevant pages in wiki/ that can answer this question:

"${question}"

Read the relevant pages, synthesize an answer with citations (page names), and present it clearly.
If the answer requires information not in the wiki, say so explicitly.`;

    const result = await provider.execute({
      prompt,
      workingDir: config.vault,
      allowedTools: ['Read', 'Glob', 'Grep'],
    });

    if (result.exitCode === 0) {
      console.log('\n' + result.stdout);
    } else {
      log.error('Query failed');
      log.dim(result.stderr);
    }
  });

// --- wiki lint ---
wikiCommand
  .command('lint')
  .description('Health check the wiki — find contradictions, orphans, stale content')
  .action(async () => {
    const config = loadConfig();
    const providerName = config.providers.default as string;
    const provider = getProviderAdapter(providerName);

    if (!(await provider.isAvailable())) {
      log.error(`Provider "${providerName}" not available.`);
      return;
    }

    log.header('Wiki Lint');
    log.step('Analyzing wiki health...');

    const prompt = `You are a wiki health checker for an Obsidian vault.

Read every file in wiki/ and _oasis/index.md. Analyze and report:

1. **Contradictions**: Pages that state conflicting information
2. **Orphans**: Pages with no inbound links from other pages
3. **Missing pages**: Concepts mentioned repeatedly in [[wikilinks]] but with no dedicated page
4. **Stale content**: Claims that seem outdated based on newer files
5. **Missing cross-references**: Pages that discuss the same topic but don't link to each other
6. **Index gaps**: Pages that exist but aren't listed in _oasis/index.md

Write a health report to wiki/lint-report.md with specific, actionable fixes for each issue found.
Include a summary score: number of issues by severity (critical/warning/suggestion).`;

    const result = await provider.execute({
      prompt,
      workingDir: config.vault,
      allowedTools: ['Read', 'Write', 'Glob', 'Grep'],
    });

    if (result.exitCode === 0) {
      log.success('Lint report generated');

      const reportPath = join(config.vault, 'wiki', 'lint-report.md');
      if (existsSync(reportPath)) {
        log.dim(`Report: ${reportPath}`);
      }

      console.log('\n' + result.stdout);
    } else {
      log.error('Lint failed');
      log.dim(result.stderr);
    }
  });
