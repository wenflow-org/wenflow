/**
 * #192：stage-designer / kc-mapper 的沙盘 ref 运行期对账（生成链 + 重排链共用）。
 *
 * 这两个 skill 的载荷由编排层手工拼装（不来自 normalizedInput），此前池里没有对应键、
 * 也从不做对账 → 「声明了 sandbox:path.*，实际值走旁路注入」长期不可见。
 * 这里用真实载荷构造 path 池（buildPathSandboxPool 已登记全部 stage 通道键），
 * 声明/载荷再次漂移（新声明未登记、或注入键被删）就会 warn。
 * 对账是观测：任何异常都吞掉，不影响生成。
 *
 * #192 复核残留：includeOptional 此前由调用点各自传，重排侧漏传 ⇒ kc-mapper 的可选通道
 * （prerequisiteTree，`object?`）恒不参与对账。现在两个调用点共用本函数，可选口径只在
 * 这里写一次，不再有「某个调用点漏传」的空间。
 */
import { buildPathSandboxPool, checkAgentSandboxRefs } from '../../sandbox-resolver.service';

export interface PathStageSandboxAuditInput {
  pathId: string;
  normalizedInput: unknown;
  /** stage-designer 的真实载荷样本（任一阶段），无样本传 null */
  stageDesignerPayload: Record<string, unknown> | null;
  /** kc-mapper 的真实载荷（subtasks / milestones / prerequisiteTree…） */
  kcMapperPayload: Record<string, unknown>;
  /** 额外告警上下文（boundary / stageNumber…） */
  warnContext?: Record<string, unknown>;
}

export async function auditPathStageAgentsSandboxRefs(input: PathStageSandboxAuditInput): Promise<void> {
  try {
    const warnContext = { pathId: input.pathId, ...(input.warnContext || {}) };
    // includeOptional：两个 skill 的 path 通道多为 `object?` 可选（#192），
    // 不传则整类声明被跳过、恒不进对账。
    await checkAgentSandboxRefs(
      'stage-designer',
      'path',
      buildPathSandboxPool((input.normalizedInput as any) || {}, input.stageDesignerPayload || {}),
      { includeOptional: true, warnContext }
    );
    await checkAgentSandboxRefs(
      'kc-mapper',
      'path',
      buildPathSandboxPool((input.normalizedInput as any) || {}, input.kcMapperPayload),
      { includeOptional: true, warnContext }
    );
  } catch {
    // 对账是观测，不影响生成
  }
}
