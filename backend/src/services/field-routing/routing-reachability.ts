/**
 * routing 可达性声明的静态门禁（#200，纯函数，无 IO / 无 DB）。
 *
 * 背景（#184）：`simulation.yaml` 里 13 条 VL 审计 routing 已按 `reachability: manual|external`
 * 标注（永久死边 → 声明为人工/外部入口，审计不再按死边计）；但**其余 routing 仍靠缺省值**，
 * 没有任何 CI 断言能拦住「新加一条永远不被自动链调用的 routing，且没人说明它为什么是默认」——
 * 这类边下一次只会以「死边」形式出现在运行时审计里（需要 DB + 观测窗口，且靠人看报表）。
 *
 * 口径（见 yaml-vocabulary.isRoutingReachabilityDeclared）：
 *   - 显式 `reachability: manual|external`，或
 *   - notes 里以 `auto — <入口说明>` 登记「我确认它是主链自动触发，入口是 X」
 * 二者居其一即视为已声明；都没有就是违规，门禁失败并逐条列出。
 *
 * 门禁范围：**已启用词表的阶段**（该阶段至少有一条 routing 带显式 reachability）。
 * 一个阶段一旦开始声明可达性，该阶段全部 routing 都必须声明——否则「新增一条忘标注的边」
 * 正好落在缺省 auto 的盲区，门禁等于没用。尚未接入词表的阶段必须出现在
 * UNGOVERNED_STAGE_REGISTRY（显式登记 + 理由）里；**没登记就出现 ⇒ 违规**，
 * 避免「自动推导管辖范围」把新阶段/新边静默放行（#200-2 复核）。
 * TODO(#200)：其余阶段是否也要接入该词表属产品口径（词表语义偏「仿真核自动链」），未拍板前不扩大范围。
 */
import { isRoutingReachabilityDeclared } from '../yaml-vocabulary';

/** 门禁输入的最小视图（容忍 prompt 演进；OrchestrationStage 结构上兼容） */
export interface RoutingReachabilityStageLike {
  stage?: string | null;
  routings?: ReadonlyArray<{
    agentId?: string | null;
    fieldId?: string | null;
    reachability?: string | null;
    notes?: string | null;
  }> | null;
}

export interface UndeclaredRouting {
  stage: string;
  agentId: string;
  fieldId: string;
}

export interface UngovernedStage {
  stage: string;
  routings: number;
  declared: number;
}

export interface RoutingReachabilityReport {
  /** 受管辖（已启用 reachability 词表）的阶段名 */
  governedStages: string[];
  /** 未声明的 routing；非空即门禁失败 */
  violations: UndeclaredRouting[];
  /** 已登记「本期不接入词表」的阶段（不在门禁范围内，仅计数公示） */
  ungovernedStages: UngovernedStage[];
  /** 既没接入词表、又没在登记表里认领的阶段；非空即门禁失败（#200-2 复核补的洞） */
  unregisteredStages: UngovernedStage[];
}

/**
 * 「本期不接入 reachability 词表」的阶段登记表（#200-2 复核）。
 *
 * 原实现按「该阶段是否已出现显式 reachability」**自动**推导管辖范围，于是未接入的阶段是
 * **静默豁免**：新增一个 stage 文件、或在既有未接入阶段里加十条 routing，门禁都只把它们
 * 算进公示计数，没人会被拦下。这里把「哪些阶段可以不接入」钉成显式登记 + 理由，并规定
 * **没登记就出现 = 违规**——词表语义（仿真核自动链）要不要外扩仍是产品口径（见上方 TODO），
 * 但「悄悄多出一个没人认领的阶段」不再可能。
 */
export const UNGOVERNED_STAGE_REGISTRY: Readonly<Record<string, string>> = {
  goal: '目标对话回合驱动（services/learning/goal-conversation.*），词表未接入',
  path: '路径生成/重规划的编排驱动（services/learning/generation、replan），词表未接入',
  teaching: '教学回合引擎驱动（services/ai-teaching），词表未接入',
  profile: '事件消费者与调度驱动（events/、bootstrap/schedulers），词表未接入',
};

export function collectRoutingReachabilityGaps(
  stages: ReadonlyArray<RoutingReachabilityStageLike>,
): RoutingReachabilityReport {
  const governedStages: string[] = [];
  const violations: UndeclaredRouting[] = [];
  const ungovernedStages: UngovernedStage[] = [];
  const unregisteredStages: UngovernedStage[] = [];

  for (const stage of stages) {
    const stageName = String(stage?.stage ?? '').trim() || '(unknown)';
    const routings = Array.isArray(stage?.routings) ? stage!.routings! : [];
    const declaredCount = routings.filter((routing) => isRoutingReachabilityDeclared(routing)).length;
    // 受管辖判据只看**显式** reachability：notes 的 auto 登记是「我已确认默认」，不是启用词表的信号
    const usesVocabulary = routings.some((routing) => !!routing?.reachability);

    if (!usesVocabulary) {
      const bucket = Object.prototype.hasOwnProperty.call(UNGOVERNED_STAGE_REGISTRY, stageName)
        ? ungovernedStages
        : unregisteredStages;
      bucket.push({ stage: stageName, routings: routings.length, declared: declaredCount });
      continue;
    }

    governedStages.push(stageName);
    for (const routing of routings) {
      if (isRoutingReachabilityDeclared(routing)) continue;
      violations.push({
        stage: stageName,
        agentId: String(routing?.agentId ?? '(missing)'),
        fieldId: String(routing?.fieldId ?? '(missing)'),
      });
    }
  }

  return { governedStages, violations, ungovernedStages, unregisteredStages };
}

/** 门禁输出文本（脚本与测试共用，保证失败信息一致） */
export function formatRoutingReachabilityReport(report: RoutingReachabilityReport): string {
  const lines: string[] = [];
  if (report.violations.length > 0) {
    lines.push(`routing 可达性未声明：${report.violations.length} 条（受管辖阶段：${report.governedStages.join(', ')}）`);
    for (const violation of report.violations) {
      lines.push(
        `  - [${violation.stage}] ${violation.agentId} · ${violation.fieldId}`
        + '  ← 需 reachability: manual|external，或在 notes 里登记 auto — <入口说明>',
      );
    }
    return lines.join('\n');
  }
  if (report.unregisteredStages.length > 0) {
    lines.push(`阶段未登记可达性口径：${report.unregisteredStages.length} 个（既无显式 reachability，也不在 UNGOVERNED_STAGE_REGISTRY 里）`);
    for (const stage of report.unregisteredStages) {
      lines.push(
        `  - ${stage.stage}：routing ${stage.routings} 条，已声明 ${stage.declared} 条`
        + '  ← 要么给该阶段补 reachability 声明，要么在 UNGOVERNED_STAGE_REGISTRY 里登记理由',
      );
    }
    return lines.join('\n');
  }
  lines.push(`routing 可达性声明完整：受管辖阶段 ${report.governedStages.join(', ') || '(无)'} 全部已声明`);
  if (report.ungovernedStages.length > 0) {
    lines.push('未接入 reachability 词表的阶段（已登记，仅公示）：');
    for (const stage of report.ungovernedStages) {
      lines.push(`  - ${stage.stage}：routing ${stage.routings} 条，其中已声明 ${stage.declared} 条`);
    }
  }
  return lines.join('\n');
}
