import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { log } from '../utils/logger.js';
import { listProjects, listTasks, type TaskFrontmatter } from './vault.js';
import type { OasisConfig } from './config.js';

export interface ContextResult {
  crossProject: string[];
  wiki: string[];
  sources: string[];
  summary: string;
}

export async function gatherContext(
  task: TaskFrontmatter,
  config: OasisConfig,
): Promise<ContextResult> {
  const result: ContextResult = {
    crossProject: [],
    wiki: [],
    sources: [],
    summary: '',
  };

  // 1. Cross-project: find related tasks by shared tags
  if (task.tags.length > 0) {
    log.step('Searching cross-project for related work...');
    const projects = listProjects(config.vault);

    for (const proj of projects) {
      const tasks = listTasks(config.vault, proj);
      for (const t of tasks) {
        if (t.id === task.id) continue;
        const shared = t.tags.filter(tag => task.tags.includes(tag));
        if (shared.length > 0) {
          const entry = `[${proj}/${t.id}] ${t.title} (${t.status}) — tags: ${shared.join(', ')}`;
          result.crossProject.push(entry);
        }
      }
    }

    if (result.crossProject.length > 0) {
      log.success(`Found ${result.crossProject.length} related tasks across projects`);
    }
  }

  // 2. Wiki: search for pages matching task tags or title words
  log.step('Searching vault wiki...');
  const wikiDir = join(config.vault, 'wiki');
  if (existsSync(wikiDir)) {
    const searchTerms = [
      ...task.tags.map(t => t.toLowerCase()),
      ...task.title.toLowerCase().split(/\s+/).filter(w => w.length > 3),
    ];

    const wikiSubdirs = ['concepts', 'patterns', 'entities', 'summaries'];
    for (const subdir of wikiSubdirs) {
      const dir = join(wikiDir, subdir);
      if (!existsSync(dir)) continue;

      const files = readdirSync(dir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const name = file.replace('.md', '').toLowerCase();
        const matches = searchTerms.some(term => name.includes(term));

        if (matches) {
          // Read first 5 lines for a preview
          const content = readFileSync(join(dir, file), 'utf-8');
          const preview = content.split('\n').slice(0, 5).join(' ').slice(0, 200);
          result.wiki.push(`wiki/${subdir}/${file}: ${preview}`);
        }
      }
    }

    if (result.wiki.length > 0) {
      log.success(`Found ${result.wiki.length} relevant wiki pages`);
    }
  }

  // 3. Skills: find project-specific skills that might be relevant
  log.step('Checking project skills...');
  const skillsDir = join(config.vault, 'projects', task.project, 'skills');
  if (existsSync(skillsDir)) {
    const skills = readdirSync(skillsDir).filter(f => f.endsWith('.md'));
    for (const skill of skills) {
      const name = skill.replace('.md', '').toLowerCase();
      const searchTerms = task.tags.map(t => t.toLowerCase());
      if (searchTerms.some(term => name.includes(term))) {
        result.sources.push(`skill: ${task.project}/skills/${skill}`);
      }
    }
  }

  // Build summary
  const parts: string[] = [];
  if (result.crossProject.length > 0) {
    parts.push(`### Related tasks across projects\n${result.crossProject.map(c => `- ${c}`).join('\n')}`);
  }
  if (result.wiki.length > 0) {
    parts.push(`### Relevant wiki pages\n${result.wiki.map(w => `- ${w}`).join('\n')}`);
  }
  if (result.sources.length > 0) {
    parts.push(`### Relevant skills\n${result.sources.map(s => `- ${s}`).join('\n')}`);
  }

  result.summary = parts.length > 0
    ? parts.join('\n\n')
    : 'No additional context found.';

  return result;
}
