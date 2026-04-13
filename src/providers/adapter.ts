export interface ExecuteOptions {
  prompt: string;
  workingDir: string;
  allowedTools?: string[];
  model?: string;
  flags?: string[];
}

export interface ExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ReviewOptions {
  artifactPath: string;
  criteria: string;
  model?: string;
  workingDir: string;
}

export interface ReviewResult {
  passed: boolean;
  feedback: string;
  issues: ReviewIssue[];
}

export interface ReviewIssue {
  severity: 'critical' | 'warning' | 'suggestion';
  message: string;
  location?: string;
}

export interface ProviderAdapter {
  name: string;
  isAvailable(): Promise<boolean>;
  getVersion(): Promise<string>;
  execute(opts: ExecuteOptions): Promise<ExecuteResult>;
  review(opts: ReviewOptions): Promise<ReviewResult>;
}
