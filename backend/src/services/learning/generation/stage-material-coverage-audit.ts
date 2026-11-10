/**
 * 全路径材料覆盖体检（只告警；2026-11-03 从 stage-enrichment.ts 拆出）。
 *
 * 判据：阶段数 ≥3、资料 ≥9 节，但所有引用都停在文档前半，或存在零引用阶段
 * ⇒ 生成当下就能看见缺口（报告里「后半引用 0」的运行期对应物），而不是等 A/B 复算才发现。
 * **不阻断、不改写模型输出**——这里只读审计并打告警日志。
 *
 * 拆出原因：`stage-enrichment.ts` 已超基线且只许缩短（超大文件棘轮），
 * 而这一簇是自洽的收尾审计，只依赖（audit 数组、normalizedInput、pathId）。
 */
import { assessMaterialCoverage, type MaterialCoverageStage } from '../../materials/material-refs';
import { logger } from '../../../utils/logger';

/** 体检门槛：少于 3 个阶段时引用分布没有意义，直接跳过（与拆分前行为一致）。 */
const MIN_STAGES_FOR_COVERAGE_AUDIT = 3;

export function auditStageMaterialCoverage(input: {
  pathId: string;
  stageMaterialAudit: ReadonlyArray<Record<string, unknown>>;
  /** 生成输入（用来取主资料的节数；两条历史路径都试，缺失按 0 处理）。 */
  normalizedInput: unknown;
}): void {
  const { pathId, stageMaterialAudit, normalizedInput } = input;
  if (stageMaterialAudit.length < MIN_STAGES_FOR_COVERAGE_AUDIT) return;
  const source = normalizedInput as {
    resources?: { materials?: Array<{ pack?: { sections?: unknown[] } }> };
    materials?: Array<{ pack?: { sections?: unknown[] } }>;
  } | null;
  const primarySectionTotal = Number(
    source?.resources?.materials?.[0]?.pack?.sections?.length
    || source?.materials?.[0]?.pack?.sections?.length
    || 0,
  );
  const coverage = assessMaterialCoverage(
    stageMaterialAudit as unknown as MaterialCoverageStage[],
    primarySectionTotal,
  );
  if (coverage.lowCoverage) {
    logger.warn('[stage-material-window] 全路径引用未覆盖资料后半', {
      pathId,
      primarySectionTotal,
      maxSection: coverage.maxSection,
      stages: stageMaterialAudit.length,
    });
  }
  if (coverage.zeroRefStages.length > 0) {
    logger.warn('[stage-material-window] 存在零引用阶段', {
      pathId,
      zeroRefStages: coverage.zeroRefStages,
      stageCount: stageMaterialAudit.length,
    });
  }
}