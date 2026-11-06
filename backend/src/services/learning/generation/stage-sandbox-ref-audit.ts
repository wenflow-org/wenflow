/**
 * #192：stage-designer / kc-mapper 的沙盘 ref 运行期对账（生成链）。
 *
 * 这两个 skill 的载荷由编排层手工拼装（不来自 normalizedInput），此前池里没有对应键、
 * 也从不做对账 → 「声明了 sandbox:path.*，实际值走旁路注入」长期不可见。
 * 这里用真实载荷构造 path 池（buildPathSandboxPool 已登记全部 stage 通道键），
 * 声明/载荷再次漂移（新声明未登记、或注入键被删）就会 warn。
 * 对账是观测：任何异常都吞掉，不影响生成。
 */
import { buildPathSandboxPool, checkAgentSandboxRefs } from '../../sandbox-resolver.service';

export async function auditStageAgentSandboxRefs(input: {
  pathId: string;
  normalizedInput: any;
  /** stage-designer 的真实载荷样本（任一阶段），见调用点的 stageSandboxSample */
  stageDesignerSample: Record<string, unknown> | null;
  stageDesignOutputs: any[];
  learningPath: { milestones: any[] };
}): Promise<void> {
  try {
    await checkAgentSandboxRefs(
      'stage-designer',
      'path',
      buildPathSandboxPool(input.normalizedInput || {}, (input.stageDesignerSample as any) || {}),
      // stage-designer 的 path 输入全部是可选通道（object?），必须 includeOptional 才看得见
      { includeOptional: true, warnContext: { pathId: input.pathId, boundary: 'generation' } }
    );
    await checkAgentSandboxRefs(
      'kc-mapper',
      'path',
      buildPathSandboxPool(input.normalizedInput || {}, {
        subtasks: input.stageDesignOutputs.flatMap((stage) => stage.subtasks),
        milestones: input.learningPath.milestones.map((m: any) => ({
          stageNumber: m.stageNumber,
          title: m.title,
          coreConcept: m.coreConceptName || m.coreConceptId,
        })),
      }),
      { warnContext: { pathId: input.pathId, boundary: 'generation' } }
    );
  } catch {
    // 对账是观测，不影响生成
  }
}
