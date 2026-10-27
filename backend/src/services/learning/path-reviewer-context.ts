/**
 * 路径评审（path-reviewer）的目标上下文构造。
 *
 * 断链修复（审计 §3.19 P1⑥）：`goalContext.successCriteria` 是 `prompts/core/path-reviewer.yaml`
 * 明确声明、且 Practicality 维度评分要用的输入，但此前调用点从未传 —— 评审只能凭 pathPlan 猜。
 * 这里从**与 path-planning 同一份定帧结果**（`analysis.sceneFraming.normalizedInput`）取，
 * 保证"生成时看到的成功标准"与"评审时用的成功标准"是同一份。
 *
 * R7-2（2026-10-27）：Practicality 规则要判断 estimatedHours 应对齐内容体量还是日历 timeBudget，
 * 需要 timeDimensions（scopeAnchorHours/calendarCapacityHours）与 resources.timeBudget。
 * 此前这两项从未传入，提示词里的引用是死引用（独立审查 M1）——评审的窄目标口径等于没生效。
 */
export interface PathReviewerGoalContext {
  surfaceGoal: string | null;
  confirmedProposal: unknown;
  learnerProfile: unknown;
  successCriteria: unknown;
  /** 时间模型（与 normalizedInput 同命名，驼峰；R8 权威字段 + legacy 诊断字段） */
  timeDimensions?: {
    scopeAnchorHours?: number | null;
    objectiveScopeHours?: number | null;
    calendarCapacityHours?: number | null;
    estimatedHours?: number | null;
    deadlineDate?: string | null;
    timeModelVersion?: number | null;
  } | null;
  /** 用户自述时间资源（含 timeBudget/timeHorizon），供对照日历容量 */
  resources?: { timeBudget?: string | null; timeHorizon?: string | null } | null;
}

export function buildPathReviewerGoalContext(input: {
  description?: string | null;
  confirmedProposal?: unknown;
  learnerProfile?: unknown;
  /** generatePathWithAgent 的返回值（含 sceneFraming.normalizedInput） */
  analysis?: unknown;
}): PathReviewerGoalContext {
  const framed = (input.analysis as
    | {
        sceneFraming?: {
          normalizedInput?: {
            successCriteria?: unknown;
            timeDimensions?: PathReviewerGoalContext['timeDimensions'];
            resources?: PathReviewerGoalContext['resources'];
          };
        } | null;
      }
    | null
    | undefined)?.sceneFraming?.normalizedInput;

  return {
    surfaceGoal: typeof input.description === 'string' && input.description.trim() ? input.description : null,
    confirmedProposal: input.confirmedProposal ?? null,
    learnerProfile: input.learnerProfile ?? null,
    successCriteria: framed?.successCriteria ?? null,
    timeDimensions: framed?.timeDimensions ?? null,
    resources: framed?.resources ?? null,
  };
}
