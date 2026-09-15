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

/**
 * 输入字节上限：超出即**降级转人工**（corer/candidate 是完整文本，判断"语义是否等价"不能截断输入，
 * 否则会给出错误结论）。默认 400KB，可用 env 覆盖。
 */
const MAX_JUDGE_PAYLOAD_BYTES = Math.max(
  10_000,
  Number(process.env.SEMANTIC_FREEZE_MAX_BYTES) || 400_000,
);

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

  // 上限护栏：超限降级转人工（不做静默截断）
  const payloadBytes = Buffer.byteLength(payload, 'utf8');
  if (payloadBytes > MAX_JUDGE_PAYLOAD_BYTES) {
    logger.warn('[semantic-freeze-judge] 输入超过字节上限，降级转人工', {
      skillId: input.skillId,
      payloadBytes,
      limit: MAX_JUDGE_PAYLOAD_BYTES,
    });
    return degradedJudgement(
      `输入过大（${payloadBytes}B > 上限 ${MAX_JUDGE_PAYLOAD_BYTES}B），转人工判定`,
      Date.now() - startTime,
    );
  }

  try {
    const result = await callPrompt<string, { verdict: string; findings?: unknown[]; rationale?: string }>({
      agentId: 'skill:semantic-freeze-judge',
      defaultSystemPrompt: '',
      requireActivePrompt: true,
      caller: { skillId: 'semantic-freeze-judge' },
            buildUserPayload: () => payload,
      // 声明 failurePolicy=retry（manifest）→ 落到实现：非法 verdict 时重试一次
      retryStrategy: {
        maxAttempts: 2,
        onValidationFail: ({ failureReason }) =>
          `上次输出不合法（${failureReason}）。请只输出一个 JSON 对象，verdict 必须是 equivalent | uncertain | divergent 三者之一。`,
      },
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
