/**
 * 独立成功率带（§7 P1-1 的控制器输入）
 *
 * **原理**：难度控制律此前是纯阻尼——7 条降档理由（各 −1，上限 −2），升档要"无任何理由 + cap=high"
 * 同时成立，于是稳态必然沉到最低档；而它的"成功"判据（同类降档理由不再出现）又是自我印证的
 * （降档本身就会让状态回落，见审计 §4.2(2)/§5.3）。要真正闭环 85% 目标，必须：
 *   ① 有一个**独立于 LLM 自评**的观测（→ 检查点答案键 + 代码裁决，`judgedBy='code'`）；
 *   ② 用它在 0.80–0.90 的**带**上做**双向**调节：低于带降档、高于带升档（死区 + 样本下限）。
 *
 * **为什么是带、为什么要样本下限**：传感器是二值结果的样本比例，标准误 SE=√(p(1−p)/n)。
 * n=6 时 SE≈0.16、n=20 时 SE≈0.08 —— 带（0.10 宽）在样本很少时比噪声还窄，
 * 此时动作就是放大噪声。故：样本不足一律"hold"（不动）；带内也 hold（死区，避免极限环）。
 *
 * **边界**：只用 `judgedBy='code'` 的观测（简答要点判定对措辞敏感、会系统性低估，故不计入带；
 * 它仍照记证据，供人工复核与效度检验）。
 */
import prisma from '../../config/database';
import { logger } from '../../utils/logger';

/** 带下沿：成功率低于它 → 说明太难，降档 */
export const SUCCESS_BAND_LOW = 0.8;
/** 带上沿：成功率高于它 → 说明太容易，升档 */
export const SUCCESS_BAND_HIGH = 0.9;
/** 带判定的最小样本数（SE 太大时不动） */
export const SUCCESS_BAND_MIN_SAMPLE = 6;
/** 回看窗口（天）：太久以前的作答不再代表当前难度是否合适 */
export const SUCCESS_BAND_WINDOW_DAYS = 14;

export type SuccessBandAction = 'downgrade' | 'hold' | 'upgrade';

export interface SuccessBandVerdict {
  action: SuccessBandAction;
  /** 代码裁决的成功率（无样本为 null） */
  rate: number | null;
  /** 参与判定的样本数（仅 judgedBy='code'） */
  sample: number;
  reason: string;
}

/**
 * 纯函数：成功率 + 样本数 → 带动作。
 * 低于带 → downgrade；高于带 → upgrade；带内或样本不足 → hold（附原因，便于留痕）。
 */
export function evaluateSuccessBand(rate: number | null, sample: number): SuccessBandVerdict {
  if (rate === null || !Number.isFinite(rate) || sample < SUCCESS_BAND_MIN_SAMPLE) {
    return {
      action: 'hold',
      rate: Number.isFinite(rate as number) ? rate : null,
      sample,
      reason: `样本不足（${sample}/${SUCCESS_BAND_MIN_SAMPLE}）或有值缺失 → 不动`,
    };
  }
  if (rate < SUCCESS_BAND_LOW) {
    return { action: 'downgrade', rate, sample, reason: `成功率 ${rate.toFixed(2)} 低于带下沿 ${SUCCESS_BAND_LOW}` };
  }
  if (rate > SUCCESS_BAND_HIGH) {
    return { action: 'upgrade', rate, sample, reason: `成功率 ${rate.toFixed(2)} 高于带上沿 ${SUCCESS_BAND_HIGH}` };
  }
  return { action: 'hold', rate, sample, reason: `成功率 ${rate.toFixed(2)} 落在带内（${SUCCESS_BAND_LOW}–${SUCCESS_BAND_HIGH}）` };
}

/** 检查点结果 payload 的最小形状（只读我们关心的字段，避免 any） */
type CheckpointResultPayload = { judgedBy?: unknown; passed?: unknown };

/**
 * 读取该学习者（可限路径）**代码裁决**的检查点成功率。
 * 只认 `judgedBy='code'`：无答案键的检查点记为 `model-reference`，是模型自评，不进带。
 */
export async function loadCodeJudgedSuccess(
  userId: string,
  options: { pathId?: string | null; since?: Date; limit?: number } = {},
): Promise<{ rate: number | null; sample: number; passed: number }> {
  const since = options.since ?? new Date(Date.now() - SUCCESS_BAND_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  try {
    const rows = await prisma.learner_evidence.findMany({
      where: {
        userId,
        evidenceType: 'checkpoint:result',
        occurredAt: { gte: since },
        ...(typeof options.pathId === 'string' && options.pathId ? { pathId: options.pathId } : {}),
      },
      orderBy: { occurredAt: 'desc' },
      take: options.limit ?? 60,
      select: { payload: true },
    });
    let codePassed = 0;
    let codeSample = 0;
    for (const row of rows) {
      let parsed: CheckpointResultPayload | null = null;
      try {
        parsed = JSON.parse(String(row.payload || '{}')) as CheckpointResultPayload;
      } catch {
        continue;
      }
      if (parsed?.judgedBy !== 'code') continue; // 模型派生判定不进带（避免自证回路）
      codeSample += 1;
      if (parsed.passed === true) codePassed += 1;
    }
    return {
      rate: codeSample > 0 ? codePassed / codeSample : null,
      sample: codeSample,
      passed: codePassed,
    };
  } catch (error) {
    logger.warn('[success-band] 读取代码裁决成功率失败（按无样本处理）', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { rate: null, sample: 0, passed: 0 };
  }
}

/** 一步到位：读 + 判（调用方拿 verdict 去驱动档位） */
export async function resolveSuccessBandVerdict(
  userId: string,
  options: { pathId?: string | null } = {},
): Promise<SuccessBandVerdict> {
  const { rate, sample } = await loadCodeJudgedSuccess(userId, options);
  return evaluateSuccessBand(rate, sample);
}
