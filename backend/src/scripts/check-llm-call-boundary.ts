import fs from 'fs/promises';
import path from 'path';

const SOURCE_DIR = path.resolve(__dirname, '..');
const ALLOWED_DIRECT_CALLERS = new Set([
  'composers/prompt-composer.ts',
  'gateway/index.ts',
]);
const FORBIDDEN_IMPORT_PATTERNS = [
  /inline-prompt-call/,
  /callInlinePrompt\s*\(/,
];

export interface DirectGatewayCallViolation {
  filePath: string;
  line: number;
  source: string;
}

async function listTypeScriptFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') return [];
      return listTypeScriptFiles(filePath);
    }
    return entry.isFile() && entry.name.endsWith('.ts') ? [filePath] : [];
  }));
  return files.flat();
}

/**
 * Business code must enter LLM calls through callPrompt (or its temporary
 * inline-prompt-call bridge). APIGateway remains the transport boundary only.
 */
export async function findDirectGatewayCallViolations(
  sourceDir = SOURCE_DIR,
): Promise<DirectGatewayCallViolation[]> {
  const violations: DirectGatewayCallViolation[] = [];
  const files = await listTypeScriptFiles(sourceDir);
  const directCall = /\bgateway\.execute\s*\(/;

  for (const filePath of files) {
    const relativePath = path.relative(sourceDir, filePath).replace(/\\/g, '/');
    if (relativePath === 'scripts/check-llm-call-boundary.ts' || ALLOWED_DIRECT_CALLERS.has(relativePath)) {
      continue;
    }
    const lines = (await fs.readFile(filePath, 'utf-8')).split(/\r?\n/);
    lines.forEach((source, index) => {
      if (directCall.test(source) || FORBIDDEN_IMPORT_PATTERNS.some((pattern) => pattern.test(source))) {
        violations.push({ filePath: relativePath, line: index + 1, source: source.trim() });
      }
    });
  }

  return violations;
}

async function main(): Promise<void> {
  const violations = await findDirectGatewayCallViolations();
  if (violations.length === 0) {
    console.log('[llm-call-boundary] PASS: all business LLM calls use callPrompt');
    return;
  }

  console.error('[llm-call-boundary] direct APIGateway.execute calls are forbidden outside the approved boundary:');
  for (const violation of violations) {
    console.error(`- ${violation.filePath}:${violation.line} ${violation.source}`);
  }
  process.exitCode = 1;
}

if (require.main === module) {
  void main();
}
