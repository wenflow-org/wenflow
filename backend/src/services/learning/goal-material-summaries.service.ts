/**
 * goal 阶段的「已上传资料清单」投影（元信息 + 理解摘要）。
 *
 * 从 goal-conversation.service 抽出：该 service 已超文件行数棘轮上限，而这段逻辑
 * 与对话状态机无关，只是“按当前目标选资料 → 等 brief → 映射 payload”。
 *
 * brief 惰性生成一次、持久化复用；受总等待预算约束——到点未就绪的降级为 headings
 * 元信息（生成在后台继续落盘，下次对话拾取）。纯本地读盘 + fail-open：任何异常
 * 返回空清单，绝不阻塞对话。
 */
import { logger } from '../../utils/logger';
import type { GoalUploadedMaterialSummary } from '../../skills/goal-conversation';
import { collectBriefsWithDeadline } from '../materials/material-brief.service';
import { selectMaterialsRanked } from '../materials/material-selection.service';

export const GOAL_MATERIAL_SUMMARY_LIMIT = 5;
/** path 实际只打包 3 份；goal 清单里同步标出哪 3 份是本次路径主线。 */
export const GOAL_PATH_MATERIAL_LIMIT = 3;

/**
 * goal 回合等待资料 brief 就绪的总预算（毫秒）。
 * 到点未就绪的资料降级为 headings 元信息；brief 生成在后台继续落盘，下次对话拾取。
 */
export const GOAL_BRIEF_DEADLINE_MS = 20_000;

export async function collectGoalUploadedMaterialSummaries(
  userId?: string,
  query?: string
): Promise<GoalUploadedMaterialSummary[]> {
  const id = typeof userId === 'string' ? userId.trim() : '';
  if (!id) return [];
  try {
    const selection = await selectMaterialsRanked({
      userId: id,
      query,
      limit: GOAL_MATERIAL_SUMMARY_LIMIT,
      includeWeb: false,
    });
    const records = selection.selected;
    if (records.length === 0) return [];
    const omittedCount = Math.max(0, selection.total - records.length);
    const briefs = await collectBriefsWithDeadline(records, GOAL_BRIEF_DEADLINE_MS);
    logger.info('[goal-conversation] 资料库选择', {
      total: selection.total,
      selected: records.map((record) => record.name),
      omitted: selection.omitted.map((record) => record.name),
      strategy: selection.strategy,
    });
    return records.map((record, index) => {
      const brief = briefs[index];
      return {
        name: record.name,
        ext: record.ext,
        format: record.format,
        charCount: record.charCount,
        headingCount: record.structure?.headingCount ?? 0,
        headings: (record.anchors || [])
          .map((anchor) => String(anchor?.heading || '').trim())
          .filter((heading) => heading && heading !== '（无标题）')
          .slice(0, 6),
        selectedForPath: index < GOAL_PATH_MATERIAL_LIMIT,
        libraryTotal: selection.total,
        libraryOmitted: omittedCount,
        brief: brief
          ? {
              docType: brief.docType,
              subject: brief.subject,
              audience: brief.audience,
              overview: brief.overview,
              naturalDivisions: brief.naturalDivisions,
              toc: brief.toc,
            }
          : null,
      };
    });
  } catch (error) {
    logger.warn('[goal-conversation] 读取上传资料清单失败，已跳过（fail-open）', {
      userId: id,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
