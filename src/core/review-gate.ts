import { log } from '../utils/logger.js';
import { getProviderAdapter } from '../providers/index.js';
import type { ReviewResult } from '../providers/adapter.js';

export type PhaseReviewMode = 'auto' | 'human' | 'skip';

export interface ReviewGateConfig {
  provider: string;
  model: string;
  phases: Record<string, PhaseReviewMode>;
  max_retries: number;
}

const PHASE_CRITERIA: Record<string, string> = {
  proposal: `Evaluate this SDD proposal critically:
- Is the scope well-defined and achievable?
- Are there missing considerations or risks not addressed?
- Is the approach technically sound?
- Are there simpler alternatives not considered?
- Does it align with the project's architecture patterns?

Be strict. Only pass if the proposal is solid and ready for spec.`,

  spec: `Evaluate this SDD specification critically:
- Is every requirement testable and unambiguous?
- Are edge cases covered?
- Are there contradictions or gaps?
- Is the API surface well-defined?
- Are acceptance criteria measurable?

Be strict. Only pass if the spec is complete enough to implement from.`,

  design: `Evaluate this SDD design critically:
- Does it follow SOLID principles?
- Is there over-engineering or unnecessary complexity?
- Are edge cases handled?
- Is the design consistent with existing codebase patterns?
- Are there performance or security concerns?
- Could this be simpler without losing functionality?

Be strict. Only pass if the design is production-ready.`,

  tasks: `Evaluate this SDD task breakdown critically:
- Are tasks ordered correctly by dependencies?
- Are all dependencies explicit?
- Is every task small enough to verify independently?
- Are there missing tasks that the spec/design require?
- Are the tasks complete — would implementing all of them satisfy the spec?

Be strict. Only pass if the task list is complete and well-ordered.`,

  apply: `Evaluate this implementation critically:
- Does the code match the spec and design?
- Is the code clean, readable, and well-structured?
- Are there tests for critical paths?
- Are there security vulnerabilities (injection, XSS, etc.)?
- Are error cases handled appropriately?
- Are there any obvious bugs or logic errors?

Be strict. Only pass if the code is production-quality.`,

  verify: `Evaluate this verification report critically:
- Were all spec requirements checked?
- Did all tests pass?
- Were edge cases tested?
- Is there anything the verification missed?

Be strict. Only pass if verification is thorough.`,
};

export interface ReviewGateResult {
  phase: string;
  passed: boolean;
  attempts: number;
  reviews: ReviewResult[];
  escalatedToHuman: boolean;
}

export async function runReviewGate(
  phase: string,
  artifactPath: string,
  workingDir: string,
  gateConfig: ReviewGateConfig,
): Promise<ReviewGateResult> {
  const mode = gateConfig.phases[phase] ?? 'auto';

  if (mode === 'skip') {
    log.dim(`Review gate for ${phase}: skipped`);
    return {
      phase,
      passed: true,
      attempts: 0,
      reviews: [],
      escalatedToHuman: false,
    };
  }

  if (mode === 'human') {
    log.info(`Review gate for ${phase}: requires human review`);
    return {
      phase,
      passed: false,
      attempts: 0,
      reviews: [],
      escalatedToHuman: true,
    };
  }

  // Auto review
  const criteria = PHASE_CRITERIA[phase] ?? `Review this ${phase} artifact critically. Is it production-ready?`;
  const provider = getProviderAdapter(gateConfig.provider);
  const reviews: ReviewResult[] = [];

  for (let attempt = 1; attempt <= gateConfig.max_retries + 1; attempt++) {
    log.step(`Auto-review ${phase} (attempt ${attempt}/${gateConfig.max_retries + 1})...`);

    const result = await provider.review({
      artifactPath,
      criteria,
      model: gateConfig.model,
      workingDir,
    });

    reviews.push(result);

    const criticalCount = result.issues.filter(i => i.severity === 'critical').length;
    const warningCount = result.issues.filter(i => i.severity === 'warning').length;
    const suggestionCount = result.issues.filter(i => i.severity === 'suggestion').length;

    if (result.passed) {
      log.success(`${phase} review PASSED`);
      if (warningCount > 0) log.warn(`${warningCount} warnings`);
      if (suggestionCount > 0) log.dim(`${suggestionCount} suggestions`);
      return { phase, passed: true, attempts: attempt, reviews, escalatedToHuman: false };
    }

    log.warn(`${phase} review FAILED (${criticalCount} critical, ${warningCount} warnings)`);

    for (const issue of result.issues) {
      const prefix = issue.severity === 'critical' ? '🔴' : issue.severity === 'warning' ? '🟡' : '💡';
      const loc = issue.location ? ` (${issue.location})` : '';
      console.log(`  ${prefix} ${issue.message}${loc}`);
    }

    if (attempt <= gateConfig.max_retries) {
      log.step(`Feedback sent for retry...`);
    }
  }

  // All retries exhausted
  log.error(`${phase} review failed after ${gateConfig.max_retries + 1} attempts. Escalating to human.`);
  return {
    phase,
    passed: false,
    attempts: gateConfig.max_retries + 1,
    reviews,
    escalatedToHuman: true,
  };
}

// --- Multi-Pass Review System ---

export interface ReviewPass {
  name: string;
  criteria: string;
}

export const REVIEW_PASSES: ReviewPass[] = [
  {
    name: 'quality',
    criteria: `Code Quality Review — evaluate strictly:
- Logic errors, off-by-one, null safety, race conditions
- Performance: unnecessary allocations, N+1 queries, blocking calls
- Readability: naming, structure, complexity (cyclomatic)
- Maintainability: coupling, cohesion, DRY violations
- Test coverage: are critical paths tested? Are edge cases covered?

Rate each dimension. Only pass if ALL dimensions are acceptable.`,
  },
  {
    name: 'security',
    criteria: `Security Review — evaluate strictly:
- Injection vulnerabilities: SQL, XSS, command injection, path traversal
- Authentication & authorization: missing checks, privilege escalation
- Data exposure: sensitive data in logs, responses, or error messages
- Input validation: untrusted input reaching dangerous sinks
- Dependency risks: known CVEs, outdated packages with security patches
- Secrets: hardcoded credentials, API keys, tokens

Any security issue is an automatic FAIL. Zero tolerance.`,
  },
  {
    name: 'dependencies',
    criteria: `Dependency & Architecture Review — evaluate strictly:
- New dependencies: are they necessary? Are there lighter alternatives?
- Version conflicts: will this break existing packages?
- License compliance: any copyleft or restrictive licenses introduced?
- Breaking changes: does this change public APIs or interfaces?
- Architectural consistency: does this follow existing patterns?
- Supply chain: are new deps from trusted sources with active maintenance?

Flag any unnecessary dependency or architectural deviation.`,
  },
];

export interface MultiPassResult {
  phase: string;
  passed: boolean;
  passes: Array<{
    name: string;
    result: ReviewResult;
  }>;
  escalatedToHuman: boolean;
}

export async function runMultiPassReview(
  phase: string,
  artifactPath: string,
  workingDir: string,
  gateConfig: ReviewGateConfig,
): Promise<MultiPassResult> {
  const mode = gateConfig.phases[phase] ?? 'auto';

  if (mode === 'skip') {
    log.dim(`Multi-pass review for ${phase}: skipped`);
    return { phase, passed: true, passes: [], escalatedToHuman: false };
  }

  if (mode === 'human') {
    log.info(`Multi-pass review for ${phase}: requires human review`);
    return { phase, passed: false, passes: [], escalatedToHuman: true };
  }

  log.step(`Running ${REVIEW_PASSES.length} parallel review passes for ${phase}...`);

  const provider = getProviderAdapter(gateConfig.provider);

  // Run all passes in parallel
  const passResults = await Promise.all(
    REVIEW_PASSES.map(async (pass) => {
      log.dim(`  → ${pass.name} pass starting...`);

      const phaseCriteria = PHASE_CRITERIA[phase] ?? '';
      const combinedCriteria = `${phaseCriteria}\n\n--- ${pass.name.toUpperCase()} PASS ---\n\n${pass.criteria}`;

      const result = await provider.review({
        artifactPath,
        criteria: combinedCriteria,
        model: gateConfig.model,
        workingDir,
      });

      return { name: pass.name, result };
    }),
  );

  // Aggregate results
  const allPassed = passResults.every(p => p.result.passed);

  for (const { name, result } of passResults) {
    const icon = result.passed ? '✓' : '✗';
    const criticals = result.issues.filter(i => i.severity === 'critical').length;
    const warnings = result.issues.filter(i => i.severity === 'warning').length;

    if (result.passed) {
      log.success(`  ${icon} ${name}: PASSED${warnings > 0 ? ` (${warnings} warnings)` : ''}`);
    } else {
      log.error(`  ${icon} ${name}: FAILED (${criticals} critical, ${warnings} warnings)`);
      for (const issue of result.issues.filter(i => i.severity === 'critical')) {
        console.log(`    🔴 ${issue.message}${issue.location ? ` (${issue.location})` : ''}`);
      }
    }
  }

  if (allPassed) {
    log.success(`${phase} multi-pass review PASSED`);
  } else {
    const failedPasses = passResults.filter(p => !p.result.passed).map(p => p.name);
    log.error(`${phase} multi-pass review FAILED — failed passes: ${failedPasses.join(', ')}`);
  }

  return {
    phase,
    passed: allPassed,
    passes: passResults,
    escalatedToHuman: !allPassed,
  };
}

export function getReviewGateConfig(projectConfig: any, globalConfig: any): ReviewGateConfig {
  const projectReview = projectConfig?.review ?? {};
  const globalReview = globalConfig?.review ?? {};

  return {
    provider: projectReview.provider || globalConfig?.providers?.default || 'claude',
    model: projectReview.model || globalReview.default_model || 'opus',
    phases: projectReview.phases ?? {
      proposal: 'auto',
      spec: 'auto',
      design: 'human',
      tasks: 'auto',
      apply: 'auto',
      verify: 'auto',
    },
    max_retries: projectReview.max_retries ?? 2,
  };
}
