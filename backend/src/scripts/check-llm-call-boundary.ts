import fs from 'fs/promises';
import path from 'path';

const SOURCE_DIR = path.resolve(__dirname, '..');
const ALLOWED_DIRECT_CALLERS = new Set([
  'composers/prompt-composer.ts',
  'gateway/index.ts',
  // 材料语义判定（2026-11-07）：stage-designer 生成流程里的一个**瞬态辅助判定**，只需一段专用
  // system prompt + 一小段 JSON 输出，不对外暴露成 skill/agent。callPrompt 会强制解析 agentId 的
  // ACTIVE prompt 与 runtime/prompt contract（prompt-composer.ts:167-176），为一个瞬态判定新增
  // agent/prompt manifest 条目属于扩大范围；故在此登记为受控直连。userId/traceId/sessionId 由
  // APIGateway.execute 从 getRequestContext() 继承，不丢追溯。
  'services/materials/subtask-material-completeness.ts',
  // 检查点简答 rubric 语义复核（2026-11-08 分级判分）：简答要点词面未全命中时的一次瞬态
  // 复核调用（要点键为出题时预注册 + 防泄漏过滤后的 rubric，temperature 0，只回 {passed,reason}）。
  // 同材料判定一个理由：为瞬态判定新增 agent/prompt manifest 条目属于扩大范围；受控直连登记。
  'services/ai-teaching/teaching-checkpoint.ts',
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
  // 2026-11-07：此前只匹配 `gateway.execute(`，`getAPIGateway().execute(` 这种接收者形态会漏掉
  // （守卫绿着、规则却被违反）。两种接收者都抓；配套自测见 __tests__/check-llm-call-boundary.test.ts。
  const directCall = /(?:\bgateway|getAPIGateway\s*\(\s*\))\s*\.execute\s*\(/;

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
