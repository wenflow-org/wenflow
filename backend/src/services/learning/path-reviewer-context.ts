/**
 * 路径评审（path-reviewer）的目标上下文构造。
 *
 * 断链修复（审计 §3.19 P1⑥）：`goalContext.successCriteria` 是 `prompts/core/path-reviewer.yaml`
 * 明确声明、且 Practicality 维度评分要用的输入，但此前调用点从未传 —— 评审只能凭 pathPlan 猜。
 * 这里从**与 path-planning 同一份定帧结果**（`analysis.sceneFraming.normalizedInput`）取，
 * 保证"生成时看到的成功标准"与"评审时用的成功标准"是同一份。
 */
export interface PathReviewerGoalContext {
  surfaceGoal: string | null;
  confirmedProposal: unknown;
  learnerProfile: unknown;
  successCriteria: unknown;
}

export function buildPathReviewerGoalContext(input: {
  description?: string | null;
  confirmedProposal?: unknown;
  learnerProfile?: unknown;
  /** generatePathWithAgent 的返回值（含 sceneFraming.normalizedInput） */
  analysis?: unknown;
}): PathReviewerGoalContext {
  const framed = (input.analysis as
    | { sceneFraming?: { normalizedInput?: { successCriteria?: unknown } } | null }
    | null
    | undefined)?.sceneFraming?.normalizedInput;

  return {
    surfaceGoal: typeof input.description === 'string' && input.description.trim() ? input.description : null,
    confirmedProposal: input.confirmedProposal ?? null,
    learnerProfile: input.learnerProfile ?? null,
    successCriteria: framed?.successCriteria ?? null,
  };
}
