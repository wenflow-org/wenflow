/**
 * 含义冻结 Judge（SKILL_PROTOCOL_V4 §4.2 守门第三查）
 *
 * 判定核心文件（SSOT）与编译产物 Prompt 之间的业务语义是否等价：
 * - equivalent：语义等价，放行
 * - divergent：字段/规则/约束有增删或含义改变，阻断发布
 * - uncertain：无法确定（含判定链路自身失败），转人工
 *
 * 保守原则：judge 调用失败、输出非法、quality 降级时一律 uncertain，绝不自动放行。
 */

import { callPrompt } from '../../composers/prompt-composer';
import { logger } from '../../utils/logger';

export type SemanticVerdict = 'equivalent' | 'uncertain' | 'divergent';

export interface SemanticFreezeFinding {
  aspect: string;
  issue: string;
  severity: 'critical' | 'major' | 'minor';
}

export interface SemanticFreezeJudgement {
  verdict: SemanticVerdict;
  findings: SemanticFreezeFinding[];
  rationale: string;
  durationMs: number;
  /** 判定链路降级（LLM 失败/输出非法/fallback）时为 true，此时 verdict 恒为 uncertain */
  degraded: boolean;
}

export interface JudgeSemanticFreezeInput {
  skillId: string;
  /** 核心文件原文（YAML） */
  coreText: string;
  /** 编译产物原文（Markdown，含 frontmatter） */
  candidateText: string;
}

const VALID_VERDICTS: readonly SemanticVerdict[] = ['equivalent', 'uncertain', 'divergent'];
const VALID_SEVERITIES = ['critical', 'major', 'minor'] as const;

function normalizeFinding(item: unknown): SemanticFreezeFinding | null {
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  const issue = typeof record.issue === 'string' ? record.issue.trim() : '';
  if (!issue) return null;
  return {
    aspect: typeof record.aspect === 'string' && record.aspect.trim() ? record.aspect.trim() : 'unknown',
    issue,
    severity: (VALID_SEVERITIES as readonly string[]).includes(record.severity as string)
      ? (record.severity as SemanticFreezeFinding['severity'])
      : 'minor',
  };
}

function degradedJudgement(reason: string, durationMs: number): SemanticFreezeJudgement {
  return {
    verdict: 'uncertain',
    findings: [{ aspect: 'judge', issue: reason, severity: 'major' }],
    rationale: '判定链路降级，按转人工处理',
    durationMs,
    degraded: true,
  };
}

/** 调用 LLM judge 判定语义等价性 */
export async function judgeSemanticFreeze(
  input: JudgeSemanticFreezeInput
): Promise<SemanticFreezeJudgement> {
  const startTime = Date.now();
  const payload = [
    '【核心文件】',
    input.coreText.trim(),
    '',
    '【编译产物】',
    input.candidateText.trim(),
  ].join('\n');

  try {
    const result = await callPrompt<string, { verdict: string; findings?: unknown[]; rationale?: string }>({
      agentId: 'skill:semantic-freeze-judge',
      defaultSystemPrompt: '',
      requireActivePrompt: true,
      caller: { skillId: 'semantic-freeze-judge' },
      modelDefaults: { temperature: 0.1, maxTokens: 4000 },
      buildUserPayload: () => payload,
      validateParsedOutput: (parsed) => ({
        valid:
          Boolean(parsed) &&
          typeof parsed === 'object' &&
          VALID_VERDICTS.includes((parsed as any).verdict),
        failureReason: 'judge verdict 必须是 equivalent | uncertain | divergent',
      }),
      normalizeOutput: (parsed) => {
        const obj = parsed && typeof parsed === 'object' ? parsed : {};
        const verdict = VALID_VERDICTS.includes((obj as any).verdict) ? (obj as any).verdict : 'uncertain';
        const findings = Array.isArray((obj as any).findings)
          ? ((obj as any).findings as unknown[]).map(normalizeFinding).filter(Boolean)
          : [];
        return {
          verdict,
          findings,
          rationale: typeof (obj as any).rationale === 'string' ? (obj as any).rationale.slice(0, 200) : '',
        };
      },
    } as any, payload);

    const durationMs = Date.now() - startTime;
    if (!result?.success || !result.output) {
      return degradedJudgement('judge 调用未产出有效结果', durationMs);
    }

    const output = result.output as { verdict: SemanticVerdict; findings: unknown[]; rationale: string };
    return {
      verdict: output.verdict,
      findings: (output.findings as SemanticFreezeFinding[]) || [],
      rationale: output.rationale || '',
      durationMs,
      degraded: false,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.warn('[semantic-freeze-judge] 判定链路失败，按 uncertain 处理', {
      skillId: input.skillId,
      error: error instanceof Error ? error.message : String(error),
    });
    return degradedJudgement(
      `judge 调用失败：${error instanceof Error ? error.message : String(error)}`,
      durationMs
    );
  }
}

/** 守门决策（纯函数）：equivalent 放行；divergent 阻断；uncertain 需人工确认 */
export function decideSemanticGate(
  judgement: SemanticFreezeJudgement,
  options: { confirmUncertain?: boolean } = {}
): 'pass' | 'block-divergent' | 'needs-confirm' {
  if (judgement.verdict === 'divergent') return 'block-divergent';
  if (judgement.verdict === 'uncertain') {
    return options.confirmUncertain ? 'pass' : 'needs-confirm';
  }
  return 'pass';
}
