/**
 * 路径评审 + 一次自动重规划（#172-6 ①②③）。
 *
 * 从 `path-generation.core.ts` 拆出（分层守卫容差 + 职责单一）：本模块只负责
 * 「评审 → 判定 → （必要时）重规划 → 对重规划结果补一次评审」这段循环，
 * 不持有落库与上下文构造。`analyzePathWithAgent` 由调用方注入，避免反向依赖。
 */
import { logger } from '../../../utils/logger';
import { executeSkillWithResult } from '../../../skills';
import { pathReviewerDefinition, PATH_REVIEW_PASS_THRESHOLD } from '../../../skills/path-reviewer';
import { buildPathReviewerGoalContext } from '../path-reviewer-context';
import type { GeneratePathData } from '../learning.types';

/**
 * 评审未通过时自动重规划的最大深度。
 *
 * 为什么需要护栏：重规划结果现在**也会再评一次**（此前重规划出的路径不经评审直接落库），
 * 若重规划同样不达标且无深度上限，「评审 → 重规划 → 评审」会一直烧 LLM 调用。
 * 深度 1 = 首评 + 一次重规划 +（对重规划结果）补一次评审，之后不论结论一律接受当前路径。
 */
export const MAX_PATH_REPLAN_DEPTH = 1;

/**
 * analyzePathWithAgent 输出中本模块消费的字段契约（完整返回字面量见
 * path-generation.core 的 analyzePathWithAgent）。索引签名放行 core 透传的
 * 其余字段（pathAgentInput/budgetConservation/…），调用方按 unknown 自行收窄。
 */
export interface PathReviewAnalysis {
  pathName?: string | null;
  summary?: string | null;
  cognitiveCore?: unknown;
  cognitiveDesign?: unknown;
  estimatedTotalHours?: number | null;
  suggestedMilestones?: Array<{
    stage?: number;
    title?: string | null;
    name?: string | null;
    coreConcept?: string;
    description?: unknown;
    goal?: string | null;
    estimatedHours?: number | null;
    materialRefs?: unknown[];
    tasks?: unknown[];
  }>;
  sceneFraming?: { normalizedInput?: unknown } | null;
  [key: string]: unknown;
}

/** path-reviewer 的评审输出：passed/score/replanInstructions 是判定字段，其余透传。 */
export interface PathReviewResult {
  passed?: boolean;
  score?: number;
  replanInstructions?: unknown;
  [key: string]: unknown;
}

/** 单次路径评审调用（best-effort：调用失败返回 null，调用方保留现有路径）。 */
async function requestPathReview(
  data: GeneratePathData,
  analysis: PathReviewAnalysis
): Promise<PathReviewResult | null> {
  // 契约：executeSkill 返回已解包 output（无 success/output 包装），此处必须走
  // executeSkillWithResult 才能拿到评审成功标志；误检 executeSkill 的 success 会让
  // 评审结论恒被丢弃、CIDPP 自动重规划永不生效（2026-10-22 审计 P1-1）。
  const reviewResult = await executeSkillWithResult(pathReviewerDefinition, {
    pathPlan: {
      name: analysis.pathName,
      summary: analysis.summary,
      cognitiveCore: analysis.cognitiveCore || analysis.cognitiveDesign,
      milestones: analysis.suggestedMilestones,
      estimatedHours: analysis.estimatedTotalHours,
    },
    // 目标上下文（含 successCriteria——yaml 声明且 Practicality 评分要用，此前漏传，§3.19 P1⑥）
    goalContext: buildPathReviewerGoalContext({
      description: data.description,
      confirmedProposal: data.userProfile?.confirmedProposal,
      learnerProfile: data.userProfile?.normalizedInput?.learnerProfile,
      analysis,
    }),
    prerequisiteTree: ((analysis.cognitiveCore || analysis.cognitiveDesign) as
      | { prerequisiteTree?: unknown }
      | null | undefined)?.prerequisiteTree,
  });
  if (reviewResult?.success && reviewResult?.output) {
    // path-reviewer 的 output 结构由其 yaml fields 声明（passed/score/replanInstructions…），
    // skill 侧已按 schema 校验；此处透传，判定字段形状见 PathReviewResult。
    return reviewResult.output as PathReviewResult;
  }
  return null;
}

export type AnalyzePathFn = (data: GeneratePathData) => Promise<PathReviewAnalysis>;

/**
 * 评审 + 一次自动重规划。
 *
 * - `path-reviewer` 的 passed 已与 finalScore 同源（score >= 0.75）；这里再加一层 score 兜底，
 *   防上游只透传模型自报 passed 时漏判。
 * - 重规划结果会**回到评审**，而不是直接落库；深度受 MAX_PATH_REPLAN_DEPTH 限制。
 */
export async function reviewPathWithAutoReplan(
  data: GeneratePathData,
  initialAnalysis: PathReviewAnalysis,
  analyzePath: AnalyzePathFn
): Promise<{ analysis: PathReviewAnalysis; pathReview: PathReviewResult | null }> {
  let analysis = initialAnalysis;
  let pathReview: PathReviewResult | null = null;
  let replanDepth = 0;

  for (;;) {
    let review: PathReviewResult | null;
    try {
      review = await requestPathReview(data, analysis);
    } catch (reviewError) {
      logger.warn('[path-reviewer] 评审调用失败（best-effort，不阻断生成）', {
        error: reviewError instanceof Error ? reviewError.message : String(reviewError),
      });
      return { analysis, pathReview };
    }
    if (!review) return { analysis, pathReview };

    pathReview = replanDepth > 0
      ? { ...review, replanned: true, replanDepth }
      : review;

    // ② score 兜底：即便 passed 仍是模型自报值（旧输出/上游未同步），低于阈值也判未通过。
    if (typeof pathReview.score === 'number' && pathReview.score < PATH_REVIEW_PASS_THRESHOLD) {
      pathReview = { ...pathReview, passed: false };
    }

    if (pathReview.passed === false && pathReview.replanInstructions) {
      if (replanDepth >= MAX_PATH_REPLAN_DEPTH) {
        logger.warn('[path-reviewer] 重规划深度已达上限，接受当前评审结论（不再重规划）', {
          score: pathReview.score,
          replanDepth,
        });
        return { analysis, pathReview };
      }
      logger.info('[path-reviewer] 路径未通过评审，触发一次自动重规划', {
        score: pathReview.score,
        replanInstructions: pathReview.replanInstructions,
        replanDepth,
      });
      try {
        const replanData: GeneratePathData = {
          ...data,
          source: 'replan',
          mode: 'replan',
          userProfile: {
            ...(data.userProfile || {}),
            replan: {
              ...(data.userProfile?.replan || {}),
              triggerSource: 'path-reviewer',
              reviewerFeedback: typeof pathReview.replanInstructions === 'string'
                ? pathReview.replanInstructions
                : undefined,
              // 被调整的原路径：此前只传反馈、不传旧路径，模型无从对照 ⇒ 规则「逐条修正评审反馈」
              // 失效、退化成同样输入的再次采样（审计 P0 §1.3）。只带渲染需要的字段，避免载荷膨胀。
              previousPlan: {
                name: analysis.pathName,
                summary: analysis.summary,
                cognitiveCore: analysis.cognitiveCore || analysis.cognitiveDesign,
                milestones: (Array.isArray(analysis.suggestedMilestones) ? analysis.suggestedMilestones : []).map((m) => ({
                  title: m?.title ?? m?.name ?? null,
                  goal: m?.goal ?? null,
                })),
              },
            },
          },
        };
        const replannedAnalysis = await analyzePath(replanData);
        if (!replannedAnalysis?.suggestedMilestones?.length) {
          logger.warn('[path-reviewer] 重规划结果为空，保留原路径', { score: pathReview.score });
          return { analysis, pathReview };
        }
        analysis = replannedAnalysis;
        replanDepth += 1;
        logger.info('[path-reviewer] 自动重规划完成，采用重规划结果并补一次评审', {
          previousScore: pathReview.score,
          replanDepth,
        });
        // ③ 回到循环顶部：重规划结果必须重新评审，不能直接落库。
        continue;
      } catch (replanError) {
        logger.warn('[path-reviewer] 自动重规划失败（best-effort，保留原路径）', {
          error: replanError instanceof Error ? replanError.message : String(replanError),
        });
        return { analysis, pathReview };
      }
    }

    return { analysis, pathReview };
  }
}
