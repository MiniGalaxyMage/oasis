import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../utils/logger.js';
import { getProviderAdapter } from '../providers/index.js';
import type { OasisConfig } from './config.js';
import type { TaskFrontmatter } from './vault.js';

export async function generateSkill(
  task: TaskFrontmatter,
  taskContent: string,
  config: OasisConfig,
): Promise<string | null> {
  if (task.complexity !== 'high') {
    log.dim('Task complexity is not high — skipping skill generation.');
    return null;
  }

  log.step('Generating skill from complex task...');

  const providerName = task.provider || config.providers.default;
  const provider = getProviderAdapter(providerName as string);

  const isAvailable = await provider.isAvailable();
  if (!isAvailable) {
    log.warn(`Provider "${providerName}" not available. Skipping skill generation.`);
    return null;
  }

  const prompt = `Analyze this completed task and extract a reusable skill/pattern from it.

## Task: ${task.id} — ${task.title}
**Project**: ${task.project}
**Tags**: ${task.tags.join(', ')}

${taskContent}

## Instructions

Create a skill document in markdown format that captures:
1. **Name**: Short, descriptive name for the pattern/skill
2. **When to apply**: What triggers tell you this skill is relevant
3. **Pattern**: The actual pattern, approach, or solution — specific enough to reuse
4. **Key decisions**: Why this approach was chosen over alternatives
5. **Gotchas**: Edge cases or mistakes to avoid
6. **Example**: A minimal code example if applicable

Format it as a clean markdown document with frontmatter:
\`\`\`yaml
---
name: "skill name"
source_task: "${task.id}"
project: "${task.project}"
tags: [${task.tags.map(t => `"${t}"`).join(', ')}]
created: "${new Date().toISOString().split('T')[0]}"
---
\`\`\`

Only output the markdown document, nothing else.`;

  const result = await provider.execute({
    prompt,
    workingDir: join(config.vault, 'projects', task.project),
    allowedTools: ['Read'],
  });

  if (result.exitCode !== 0 || !result.stdout.trim()) {
    log.warn('Skill generation failed or produced empty output.');
    return null;
  }

  // Save skill to project
  const skillsDir = join(config.vault, 'projects', task.project, 'skills');
  if (!existsSync(skillsDir)) {
    mkdirSync(skillsDir, { recursive: true });
  }

  const slug = task.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50);
  const skillPath = join(skillsDir, `${slug}.md`);
  writeFileSync(skillPath, result.stdout, 'utf-8');
  log.success(`Skill saved: ${skillPath}`);

  // Also add to wiki/patterns for cross-project discovery
  const wikiPatternsDir = join(config.vault, 'wiki', 'patterns');
  if (!existsSync(wikiPatternsDir)) {
    mkdirSync(wikiPatternsDir, { recursive: true });
  }

  const wikiEntry = `---
source: ${task.project}/skills/${slug}.md
task: ${task.id}
project: ${task.project}
tags: [${task.tags.join(', ')}]
---

# ${task.title}

Cross-project reference to skill generated from task ${task.id} in ${task.project}.

See: [[${task.project}/skills/${slug}]]
`;

  const wikiPath = join(wikiPatternsDir, `${task.project}-${slug}.md`);
  if (!existsSync(wikiPath)) {
    writeFileSync(wikiPath, wikiEntry, 'utf-8');
    log.success(`Wiki pattern reference: ${wikiPath}`);
  }

  return skillPath;
}
